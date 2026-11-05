import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PaystackClient } from '../paystack/paystack.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYSTACK_RECOVERY_COOLDOWN_MS,
  PAYSTACK_RECOVERY_DEADLINE_MS,
  PAYSTACK_RECOVERY_KEY,
  PAYSTACK_RECOVERY_LEASE_MS,
  PAYSTACK_RECOVERY_MAX_AGE_MS,
  PAYSTACK_RECOVERY_MAX_CANDIDATES,
  PAYSTACK_RECOVERY_MAX_PAGES,
  PAYSTACK_RECOVERY_PAGE_SIZE,
  PaystackKycRecoveryMetadata,
  PaystackKycRecoveryState,
  PaystackKycRecoveryView,
  paystackRecoveryMessage,
  toPaystackRecoveryView,
} from './paystack-kyc-recovery.types';

// Keep the projection helper available from the service entry point as well as
// the types module for callers that do not need the internal metadata types.
export { toPaystackRecoveryView };

type JsonRecord = Record<string, unknown>;

type PendingAttempt = {
  id: string;
  userId: string;
  documentId: string;
  reference: string;
  checks: unknown;
  createdAt: Date;
  consentRecordedAt?: Date | null;
  document?: { id: string; type: string } | null;
};

type CustomerBinding = {
  userId: string;
  customerCode: string;
  customerId: string | null;
  validationFingerprint: string | null;
  validationStatus: string;
};

type RecoverySnapshot = {
  userId: string;
  token: string;
  now: Date;
  pending: PendingAttempt;
  customer: CustomerBinding | null;
};

type ViewResult = { kind: 'VIEW'; view: PaystackKycRecoveryView };
type ReservedResult = { kind: 'RESERVED'; eventId: string };
type NoPendingResult = { kind: 'NO_PENDING'; view: PaystackKycRecoveryView };

type EventResolution =
  | {
      kind: 'MATCH';
      eventId: string;
      eventType:
        | 'customeridentification.success'
        | 'customeridentification.failed';
    }
  | { kind: 'NONE'; identified: boolean; complete: true }
  | { kind: 'INCOMPLETE' }
  | { kind: 'AMBIGUOUS' };

const TARGET_EVENT_TYPES = new Set([
  'customeridentification.success',
  'customeridentification.failed',
]);

/**
 * Reconciles an already-reserved Paystack BVN attempt without submitting a
 * second identification request. Only a genuine, fully-correlated provider
 * event may be requested for resend; the signed webhook worker remains the
 * sole state finalizer.
 */
@Injectable()
export class PaystackKycRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  async reconcile(userId: string): Promise<PaystackKycRecoveryView> {
    const token = randomUUID();
    const now = new Date();
    const deadlineAt = Date.now() + PAYSTACK_RECOVERY_DEADLINE_MS;

    let started: RecoverySnapshot | ViewResult | NoPendingResult;
    try {
      started = await this.begin(userId, token, now);
    } catch (error: unknown) {
      this.logProviderError(userId, 'begin', error);
      return this.unavailableView('unknown');
    }

    if ('kind' in started) {
      return started.view;
    }

    const { pending, customer } = started;
    if (!customer || !customer.customerCode || !customer.customerId) {
      return this.finishState(started, 'ACTION_REQUIRED', {
        eventHistoryComplete: false,
      });
    }

    const checks = asRecord(pending.checks);
    const customerCode = asSafeString(checks?.customerCode);
    const fingerprint = asSafeString(checks?.validationFingerprint);
    if (
      customerCode !== customer.customerCode ||
      !fingerprint ||
      !customer.validationFingerprint ||
      fingerprint !== customer.validationFingerprint
    ) {
      return this.finishState(started, 'ACTION_REQUIRED', {
        eventHistoryComplete: false,
      });
    }

    const expectedDomain = this.expectedDomain();
    if (!expectedDomain) {
      return this.finishState(started, 'TEMPORARILY_UNAVAILABLE', {
        eventHistoryComplete: false,
      });
    }

    let customerState: { identified: boolean };
    try {
      customerState = await this.readAndValidateCustomer(
        customer,
        expectedDomain,
        deadlineAt,
      );
    } catch (error: unknown) {
      this.logProviderError(userId, 'customer-read', error);
      return this.finishState(
        started,
        this.isUnavailable(error)
          ? 'TEMPORARILY_UNAVAILABLE'
          : 'ACTION_REQUIRED',
        { eventHistoryComplete: false },
      );
    }

    let events: EventResolution;
    try {
      events = await this.findTerminalEvent(
        customer,
        attemptStartedAt(pending),
        expectedDomain,
        deadlineAt,
      );
    } catch (error: unknown) {
      this.logProviderError(userId, 'event-history', error);
      return this.finishState(
        started,
        this.isUnavailable(error)
          ? 'TEMPORARILY_UNAVAILABLE'
          : 'ACTION_REQUIRED',
        {
          customerIdentified: customerState.identified,
          eventHistoryComplete: false,
        },
      );
    }

    if (events.kind === 'INCOMPLETE' || events.kind === 'AMBIGUOUS') {
      return this.finishState(started, 'ACTION_REQUIRED', {
        customerIdentified: customerState.identified,
        eventHistoryComplete: false,
      });
    }

    if (events.kind === 'NONE') {
      const prior = this.readRecovery(pending.checks);
      const lastSubmission = Math.max(
        attemptStartedAt(pending).getTime(),
        Date.parse(prior?.resubmittedAt ?? '') || 0,
      );
      const stale =
        now.getTime() - lastSubmission >= PAYSTACK_RECOVERY_MAX_AGE_MS;
      return this.finishState(
        started,
        stale || customerState.identified
          ? 'ACTION_REQUIRED'
          : 'AWAITING_PROVIDER',
        {
          customerIdentified: customerState.identified,
          eventHistoryComplete: true,
          retryAllowed:
            stale &&
            !customerState.identified &&
            (prior?.resubmissionCount ?? 0) < 2,
        },
      );
    }

    let reserved: ReservedResult | ViewResult | NoPendingResult;
    if (this.deadlineExceeded(deadlineAt)) {
      return this.finishState(started, 'TEMPORARILY_UNAVAILABLE', {
        customerIdentified: customerState.identified,
        eventHistoryComplete: true,
      });
    }
    try {
      reserved = await this.reserveReplay(started, events);
    } catch (error: unknown) {
      this.logProviderError(userId, 'replay-reservation', error);
      return this.unavailableView('database');
    }
    if (reserved.kind === 'NO_PENDING' || reserved.kind === 'VIEW') {
      return reserved.view;
    }

    if (this.deadlineExceeded(deadlineAt)) {
      return this.finishState(started, 'TEMPORARILY_UNAVAILABLE', {
        replayEventId: reserved.eventId,
        replayStatus: 'UNKNOWN',
        replayRequestedAt: null,
        eventHistoryComplete: true,
      });
    }

    try {
      const response = await this.withDeadline(deadlineAt, () =>
        this.paystack.request<Record<string, unknown>>(
          'POST',
          '/integration/webhooks/events/resend',
          { ids: [reserved.eventId] },
        ),
      );
      this.assertWithinDeadline(deadlineAt);
      if (this.replayRejected(response)) {
        throw new ServiceUnavailableException(
          'Paystack replay was not accepted',
        );
      }
    } catch (error: unknown) {
      this.logProviderError(userId, 'replay-request', error);
      return this.finishState(started, 'TEMPORARILY_UNAVAILABLE', {
        replayEventId: reserved.eventId,
        replayStatus: 'UNKNOWN',
        replayRequestedAt: null,
        eventHistoryComplete: true,
      });
    }

    return this.finishState(started, 'WEBHOOK_REQUESTED', {
      replayEventId: reserved.eventId,
      replayStatus: 'REQUESTED',
      replayRequestedAt: now.toISOString(),
      eventHistoryComplete: true,
    });
  }

  private async begin(
    userId: string,
    token: string,
    now: Date,
  ): Promise<RecoverySnapshot | ViewResult | NoPendingResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);

      const [customer, pending] = await Promise.all([
        tx.paystackCustomer.findUnique({
          where: { userId },
          select: {
            userId: true,
            customerCode: true,
            customerId: true,
            validationFingerprint: true,
            validationStatus: true,
          },
        }),
        tx.kycVerification.findFirst({
          where: {
            userId,
            provider: 'PAYSTACK',
            status: 'PENDING',
            document: { is: { type: 'BVN' } },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            userId: true,
            documentId: true,
            reference: true,
            checks: true,
            createdAt: true,
            consentRecordedAt: true,
            document: { select: { id: true, type: true } },
          },
        }),
      ]);

      if (!pending) {
        return {
          kind: 'NO_PENDING',
          view: this.noPendingView(),
        } satisfies NoPendingResult;
      }

      const recovery = this.readRecovery(pending.checks);
      const pendingSince = attemptStartedAt(pending).toISOString();
      const supportReference = recoverySupportReference(pending.documentId);
      const currentView = toPaystackRecoveryView(
        pending.documentId,
        attemptStartedAt(pending),
        recovery,
      );

      if (this.activeLease(recovery, now)) {
        return { kind: 'VIEW', view: currentView } satisfies ViewResult;
      }

      if (this.cooldownActive(recovery, now)) {
        return { kind: 'VIEW', view: currentView } satisfies ViewResult;
      }

      if (recovery?.replayEventId) {
        const replayState: PaystackKycRecoveryState =
          recovery.replayStatus === 'REQUESTED'
            ? 'WEBHOOK_REQUESTED'
            : 'TEMPORARILY_UNAVAILABLE';
        return {
          kind: 'VIEW',
          view: toPaystackRecoveryView(
            pending.documentId,
            attemptStartedAt(pending),
            {
              ...recovery,
              state: replayState,
              supportReference,
            },
          ),
        } satisfies ViewResult;
      }

      const checking: PaystackKycRecoveryMetadata = {
        state: 'CHECKING',
        message: paystackRecoveryMessage('CHECKING'),
        supportReference,
        pendingSince,
        checkedAt: null,
        leaseId: token,
        leaseUntil: new Date(
          now.getTime() + PAYSTACK_RECOVERY_LEASE_MS,
        ).toISOString(),
        cooldownUntil: null,
        ...(recovery?.replayEventId
          ? {
              replayEventId: recovery.replayEventId,
              replayEventType: recovery.replayEventType ?? null,
              replayStatus: recovery.replayStatus ?? null,
            }
          : {}),
      };
      const checks = {
        ...(asRecord(pending.checks) ?? {}),
        [PAYSTACK_RECOVERY_KEY]: checking,
      };
      const claimed = await tx.kycVerification.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: { checks: checks as unknown as Prisma.InputJsonValue },
      });
      if (claimed.count !== 1) {
        return {
          kind: 'VIEW',
          view: toPaystackRecoveryView(
            pending.documentId,
            attemptStartedAt(pending),
            recovery,
          ),
        } satisfies ViewResult;
      }
      await this.writeAudit(tx, 'PAYSTACK_KYC_RECOVERY_STARTED', pending.id, {
        userId,
        documentId: pending.documentId,
        provider: 'PAYSTACK',
        state: 'CHECKING',
      });

      return {
        userId,
        token,
        now,
        pending,
        customer,
      } satisfies RecoverySnapshot;
    });
  }

  private async readAndValidateCustomer(
    binding: CustomerBinding,
    expectedDomain: 'live' | 'test',
    deadlineAt: number,
  ) {
    this.assertWithinDeadline(deadlineAt);
    const customer = asRecord(
      await this.withDeadline(deadlineAt, () =>
        this.paystack.request<unknown>(
          'GET',
          `/customer/${encodeURIComponent(binding.customerCode)}`,
        ),
      ),
    );
    this.assertWithinDeadline(deadlineAt);
    if (!customer) throw new Error('Invalid Paystack customer response');
    const customerCode = asSafeString(customer.customer_code);
    const customerId = asSafeString(customer.id);
    const domain = asSafeString(customer.domain);
    if (
      customerCode !== binding.customerCode ||
      customerId !== binding.customerId ||
      domain !== expectedDomain
    ) {
      throw new RecoveryCorrelationError('customer');
    }
    return { identified: customer.identified === true };
  }

  private async findTerminalEvent(
    binding: CustomerBinding,
    pendingSince: Date,
    expectedDomain: 'live' | 'test',
    deadlineAt: number,
  ): Promise<EventResolution> {
    let cursor: string | undefined;
    let pages = 0;
    const candidates = new Map<
      string,
      { category: string; eventType: string }
    >();
    let complete = false;

    while (pages < PAYSTACK_RECOVERY_MAX_PAGES) {
      pages += 1;
      const params: Record<string, string> = {
        category_row_id: binding.customerId!,
        from: pendingSince.toISOString(),
        limit: String(PAYSTACK_RECOVERY_PAGE_SIZE),
      };
      if (cursor) params.next = cursor;
      this.assertWithinDeadline(deadlineAt);
      const page = await this.withDeadline(deadlineAt, () =>
        this.paystack.page<unknown>('/integration/webhooks/events', params),
      );
      this.assertWithinDeadline(deadlineAt);
      if (!page || !Array.isArray(page.data)) {
        throw new Error('Invalid Paystack event history response');
      }
      for (const summary of page.data) {
        const row = asRecord(summary);
        if (!row) continue;
        const eventType = this.eventType(row);
        const rowDomain = asSafeString(row.domain);
        const rowCustomerId = asSafeString(row.category_row_id);
        if (
          (rowDomain && rowDomain !== expectedDomain) ||
          (rowCustomerId && rowCustomerId !== binding.customerId) ||
          (eventType && !TARGET_EVENT_TYPES.has(eventType))
        ) {
          continue;
        }
        const id = asProviderId(row._id);
        const category = asSafeString(row.category);
        if (
          !id ||
          !category ||
          !eventType ||
          rowDomain !== expectedDomain ||
          rowCustomerId !== binding.customerId
        ) {
          return { kind: 'INCOMPLETE' };
        }
        candidates.set(id, { category, eventType });
        if (candidates.size > PAYSTACK_RECOVERY_MAX_CANDIDATES) {
          return { kind: 'INCOMPLETE' };
        }
      }
      const next = asProviderId(page.meta?.next);
      if (!next) {
        complete = true;
        break;
      }
      cursor = next;
    }
    if (!complete) return { kind: 'INCOMPLETE' };

    const matches: Array<{
      eventId: string;
      eventType:
        | 'customeridentification.success'
        | 'customeridentification.failed';
    }> = [];
    for (const [eventId, summary] of candidates) {
      this.assertWithinDeadline(deadlineAt);
      const detail = asRecord(
        await this.withDeadline(deadlineAt, () =>
          this.paystack.request<unknown>(
            'GET',
            `/integration/webhooks/events/${encodeURIComponent(eventId)}`,
          ),
        ),
      );
      this.assertWithinDeadline(deadlineAt);
      const detailDomain = asSafeString(detail?.domain);
      const detailId = asProviderId(detail?._id);
      const eventCreatedAt = asIso(detail?.createdAt);
      const eventTime = eventCreatedAt
        ? Date.parse(eventCreatedAt)
        : Number.NaN;
      if (
        detailDomain !== expectedDomain ||
        detailId !== eventId ||
        asSafeString(detail?.category) !== summary.category ||
        asSafeString(detail?.category_row_id) !== binding.customerId ||
        asSafeString(detail?.event_name) !== summary.eventType ||
        !Number.isFinite(eventTime) ||
        eventTime < pendingSince.getTime() ||
        eventTime > Date.now() + 60_000
      )
        return { kind: 'INCOMPLETE' };
      const payload = asRecord(detail?.event_payload);
      const eventType = asSafeString(payload?.event);
      const data = asRecord(payload?.data);
      const customerCode = asSafeString(data?.customer_code);
      const customerId = asSafeString(data?.customer_id);
      if (
        !eventType ||
        !TARGET_EVENT_TYPES.has(eventType) ||
        customerCode !== binding.customerCode ||
        customerId !== binding.customerId ||
        eventType !== summary.eventType
      ) {
        continue;
      }
      matches.push({
        eventId,
        eventType: eventType as
          | 'customeridentification.success'
          | 'customeridentification.failed',
      });
      if (matches.length > 1) return { kind: 'AMBIGUOUS' };
    }
    if (matches.length === 1) return { kind: 'MATCH', ...matches[0] };
    return {
      kind: 'NONE',
      identified: false,
      complete: true,
    };
  }

  private async reserveReplay(
    snapshot: RecoverySnapshot,
    event: Extract<EventResolution, { kind: 'MATCH' }>,
  ): Promise<ReservedResult | ViewResult | NoPendingResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, snapshot.userId);
      const current = await tx.kycVerification.findUnique({
        where: { id: snapshot.pending.id },
        select: {
          id: true,
          status: true,
          documentId: true,
          reference: true,
          checks: true,
          createdAt: true,
          consentRecordedAt: true,
        },
      });
      if (!current || current.status !== 'PENDING') {
        return {
          kind: 'NO_PENDING',
          view: this.noPendingView(),
        } satisfies NoPendingResult;
      }
      const recovery = this.readRecovery(current.checks);
      if (recovery?.replayEventId) {
        return {
          kind: 'VIEW',
          view: toPaystackRecoveryView(
            current.documentId,
            attemptStartedAt(current),
            recovery,
          ),
        } satisfies ViewResult;
      }
      if (recovery?.leaseId !== snapshot.token) {
        return {
          kind: 'VIEW',
          view: toPaystackRecoveryView(
            current.documentId,
            attemptStartedAt(current),
            recovery,
          ),
        } satisfies ViewResult;
      }

      const reserved: PaystackKycRecoveryMetadata = {
        ...(recovery ??
          this.defaultRecovery(current.documentId, attemptStartedAt(current))),
        state: 'CHECKING',
        message: paystackRecoveryMessage('CHECKING'),
        replayEventId: event.eventId,
        replayEventType: event.eventType,
        replayStatus: 'RESERVED',
        replayReservedAt: snapshot.now.toISOString(),
        replayRequestedAt: null,
      };
      const checks = {
        ...(asRecord(current.checks) ?? {}),
        [PAYSTACK_RECOVERY_KEY]: reserved,
      };
      const updated = await tx.kycVerification.updateMany({
        where: { id: current.id, status: 'PENDING' },
        data: { checks: checks as unknown as Prisma.InputJsonValue },
      });
      if (updated.count !== 1) {
        return {
          kind: 'NO_PENDING',
          view: this.noPendingView(),
        } satisfies NoPendingResult;
      }
      await this.writeAudit(
        tx,
        'PAYSTACK_KYC_RECOVERY_REPLAY_RESERVED',
        current.id,
        {
          userId: snapshot.userId,
          documentId: current.documentId,
          provider: 'PAYSTACK',
          replayEventId: event.eventId,
          eventType: event.eventType,
        },
      );
      return {
        kind: 'RESERVED',
        eventId: event.eventId,
      } satisfies ReservedResult;
    });
  }

  private async finishState(
    snapshot: RecoverySnapshot,
    state: PaystackKycRecoveryState,
    facts: Partial<PaystackKycRecoveryMetadata> = {},
  ): Promise<PaystackKycRecoveryView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, snapshot.userId);
        const current = await tx.kycVerification.findUnique({
          where: { id: snapshot.pending.id },
          select: {
            id: true,
            status: true,
            documentId: true,
            reference: true,
            checks: true,
            createdAt: true,
            consentRecordedAt: true,
          },
        });
        if (!current || current.status !== 'PENDING') {
          return this.noPendingView();
        }
        const recovery = this.readRecovery(current.checks);
        if (recovery?.leaseId !== snapshot.token) {
          return toPaystackRecoveryView(
            current.documentId,
            attemptStartedAt(current),
            recovery,
          );
        }
        const checkedAt = snapshot.now.toISOString();
        const cooldownUntil = new Date(
          snapshot.now.getTime() + PAYSTACK_RECOVERY_COOLDOWN_MS,
        ).toISOString();
        const next: PaystackKycRecoveryMetadata = {
          ...(recovery ??
            this.defaultRecovery(
              current.documentId,
              attemptStartedAt(current),
            )),
          retryAllowed: false,
          ...facts,
          state,
          message: paystackRecoveryMessage(state),
          checkedAt,
          leaseId: null,
          leaseUntil: null,
          cooldownUntil,
          pendingSince: attemptStartedAt(current).toISOString(),
          supportReference: recoverySupportReference(current.documentId),
        };
        const checks = {
          ...(asRecord(current.checks) ?? {}),
          [PAYSTACK_RECOVERY_KEY]: next,
        };
        const updated = await tx.kycVerification.updateMany({
          where: { id: current.id, status: 'PENDING' },
          data: { checks: checks as unknown as Prisma.InputJsonValue },
        });
        if (updated.count !== 1) return this.noPendingView();
        await this.writeAudit(tx, this.auditAction(state), current.id, {
          userId: snapshot.userId,
          documentId: current.documentId,
          provider: 'PAYSTACK',
          state,
          ...(facts.replayEventId
            ? { replayEventId: facts.replayEventId }
            : {}),
          ...(facts.replayStatus ? { replayStatus: facts.replayStatus } : {}),
        });
        return toPaystackRecoveryView(
          current.documentId,
          attemptStartedAt(current),
          next,
        );
      });
    } catch (error: unknown) {
      this.logProviderError(snapshot.userId, 'finish', error);
      return this.unavailableView('database');
    }
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`,
    );
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    action: string,
    targetId: string,
    metadata: JsonRecord,
  ) {
    await tx.auditLog.create({
      data: {
        action,
        targetType: 'KycVerification',
        targetId,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private readRecovery(value: unknown): PaystackKycRecoveryMetadata | null {
    const checks = asRecord(value);
    const raw = asRecord(checks?.[PAYSTACK_RECOVERY_KEY]);
    if (!raw) return null;
    const state = asRecoveryState(raw.state);
    if (!state) return null;
    const supportReference = asSafeString(raw.supportReference);
    const pendingSince = asIso(raw.pendingSince);
    const checkedAt = asIso(raw.checkedAt);
    if (!checkedAt && raw.checkedAt !== null && raw.checkedAt !== undefined) {
      return null;
    }
    return {
      state,
      message: paystackRecoveryMessage(state),
      supportReference,
      pendingSince,
      checkedAt,
      retryAllowed: raw.retryAllowed === true,
      resubmissionCount:
        typeof raw.resubmissionCount === 'number' &&
        Number.isSafeInteger(raw.resubmissionCount) &&
        raw.resubmissionCount >= 0
          ? raw.resubmissionCount
          : 0,
      ...(asIso(raw.resubmittedAt)
        ? { resubmittedAt: asIso(raw.resubmittedAt)! }
        : {}),
      leaseId: asSafeString(raw.leaseId),
      leaseUntil: asIso(raw.leaseUntil),
      cooldownUntil: asIso(raw.cooldownUntil),
      replayEventId: asProviderId(raw.replayEventId),
      replayEventType: asEventType(raw.replayEventType),
      replayStatus: asReplayStatus(raw.replayStatus),
      replayReservedAt: asIso(raw.replayReservedAt),
      replayRequestedAt: asIso(raw.replayRequestedAt),
      customerIdentified:
        typeof raw.customerIdentified === 'boolean'
          ? raw.customerIdentified
          : undefined,
      eventHistoryComplete:
        typeof raw.eventHistoryComplete === 'boolean'
          ? raw.eventHistoryComplete
          : undefined,
    };
  }

  private defaultRecovery(
    documentId: string,
    pendingSince: Date,
  ): PaystackKycRecoveryMetadata {
    return {
      state: 'CHECKING',
      message: paystackRecoveryMessage('CHECKING'),
      supportReference: recoverySupportReference(documentId),
      pendingSince: pendingSince.toISOString(),
      checkedAt: null,
    };
  }

  private activeLease(recovery: PaystackKycRecoveryMetadata | null, now: Date) {
    if (!recovery?.leaseId || !recovery.leaseUntil) return false;
    const leaseUntil = Date.parse(recovery.leaseUntil);
    return Number.isFinite(leaseUntil) && leaseUntil > now.getTime();
  }

  private cooldownActive(
    recovery: PaystackKycRecoveryMetadata | null,
    now: Date,
  ) {
    if (!recovery?.cooldownUntil) return false;
    const cooldownUntil = Date.parse(recovery.cooldownUntil);
    return Number.isFinite(cooldownUntil) && cooldownUntil > now.getTime();
  }

  private expectedDomain(): 'live' | 'test' | null {
    const configured = this.config
      .get<string>('PAYSTACK_DOMAIN')
      ?.trim()
      .toLowerCase();
    if (configured === 'live' || configured === 'test') return configured;
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim() ?? '';
    if (key.startsWith('sk_live_')) return 'live';
    if (key.startsWith('sk_test_')) return 'test';
    return null;
  }

  private eventType(row: JsonRecord) {
    return asSafeString(row.event_name ?? row.event);
  }

  private replayRejected(value: unknown) {
    const response = asRecord(value);
    // An empty/malformed response is not proof that Paystack accepted the
    // resend. The event is already reserved, so treat it as unknown and do
    // not allow a later request to send it again.
    if (!response) return true;
    return (
      response.count !== 1 ||
      response.failed !== 0 ||
      !Array.isArray(response.failed_ids) ||
      response.failed_ids.length !== 0
    );
  }

  private auditAction(state: PaystackKycRecoveryState) {
    if (state === 'WEBHOOK_REQUESTED')
      return 'PAYSTACK_KYC_RECOVERY_REPLAY_REQUESTED';
    if (state === 'TEMPORARILY_UNAVAILABLE')
      return 'PAYSTACK_KYC_RECOVERY_UNAVAILABLE';
    if (state === 'ACTION_REQUIRED')
      return 'PAYSTACK_KYC_RECOVERY_ACTION_REQUIRED';
    return 'PAYSTACK_KYC_RECOVERY_CHECKED';
  }

  private noPendingView() {
    return toPaystackRecoveryView('', undefined, { state: 'NO_PENDING' });
  }

  private unavailableView(reason: 'unknown' | 'database') {
    return toPaystackRecoveryView('', new Date(), {
      state: 'TEMPORARILY_UNAVAILABLE',
      checkedAt: new Date().toISOString(),
      supportReference: null,
      reason,
    });
  }

  private isUnavailable(error: unknown) {
    if (error instanceof RecoveryDeadlineError) return true;
    if (error instanceof ServiceUnavailableException) return true;
    if (!(error instanceof Error)) return false;
    return /timeout|timed out|econn|network|unavailable/i.test(
      `${error.name} ${error.message}`,
    );
  }

  private logProviderError(userId: string, operation: string, error: unknown) {
    this.logger.warn(
      {
        userId,
        operation,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Paystack KYC recovery operation failed',
    );
  }

  private deadlineExceeded(deadlineAt: number) {
    return Date.now() >= deadlineAt;
  }

  private async withDeadline<T>(
    deadlineAt: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertWithinDeadline(deadlineAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new RecoveryDeadlineError()),
            Math.max(1, deadlineAt - Date.now()),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private assertWithinDeadline(deadlineAt: number) {
    if (this.deadlineExceeded(deadlineAt)) throw new RecoveryDeadlineError();
  }
}

class RecoveryCorrelationError extends Error {
  constructor(operation: string) {
    super(`Paystack recovery correlation failed: ${operation}`);
    this.name = 'RecoveryCorrelationError';
  }
}

class RecoveryDeadlineError extends Error {
  constructor() {
    super('Paystack recovery deadline exceeded');
    this.name = 'RecoveryDeadlineError';
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asSafeString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized.length > 0 && normalized.length <= 512 ? normalized : null;
}

function asProviderId(value: unknown): string | null {
  const normalized = asSafeString(value);
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function recoverySupportReference(documentId: string) {
  const normalized = documentId.trim();
  return normalized ? `KYC-${normalized}` : '';
}

function asIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecoveryState(value: unknown): PaystackKycRecoveryState | null {
  return value === 'CHECKING' ||
    value === 'AWAITING_PROVIDER' ||
    value === 'ACTION_REQUIRED' ||
    value === 'WEBHOOK_REQUESTED' ||
    value === 'TEMPORARILY_UNAVAILABLE' ||
    value === 'NO_PENDING'
    ? value
    : null;
}

function asReplayStatus(
  value: unknown,
): PaystackKycRecoveryMetadata['replayStatus'] {
  return value === 'RESERVED' || value === 'REQUESTED' || value === 'UNKNOWN'
    ? value
    : null;
}

function asEventType(
  value: unknown,
): PaystackKycRecoveryMetadata['replayEventType'] {
  return value === 'customeridentification.success' ||
    value === 'customeridentification.failed'
    ? value
    : null;
}

function attemptStartedAt(attempt: {
  createdAt: Date;
  consentRecordedAt?: Date | null;
}) {
  return attempt.consentRecordedAt ?? attempt.createdAt;
}
