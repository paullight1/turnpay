import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ManualExchangeOrder,
  ManualExchangeSettlement,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { LedgerService } from '../wallets/ledger.service';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { isKycTierAtLeast } from '../common/utils/kyc-tier';
import { allocateDepositReference } from '../common/services/deposit-allocation';
import type { RequestAuditContext } from '../common/services/request-audit-context';
import { RateService } from './providers/rate.service';
import {
  AttachManualProofDto,
  CreateManualExchangeDto,
  ManualExchangeReminderDto,
  ManualProofUploadDto,
  ReviewManualExchangeDto,
} from './dto/manual-exchange.dto';
import {
  ManualStatus,
  ManualPayoutOutcome,
  manualDeliveryOptions,
  assertManualDelivery,
  nextManualExchangeStatus,
  nextManualPayoutHandoverStatus,
  quoteManualExchange,
} from './manual-exchange.policy';
import { SettlementHoldService } from '../common/services/settlement-hold.service';

const include = { events: { orderBy: { createdAt: 'asc' as const } } };
type Order = Prisma.ManualExchangeOrderGetPayload<{ include: typeof include }>;
const proofTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const requestHash = (value: unknown) => hash(JSON.stringify(value));
const proofOpen = [
  'AWAITING_TRANSFER',
  'AWAITING_CONFIRMATION',
  'NEEDS_MORE_INFO',
];
const reviewReminderStatuses = [
  'AWAITING_CONFIRMATION',
  'PAYOUT_PENDING',
  'PAYOUT_PROCESSING',
  'PAYOUT_SENT',
] as const;
const reviewReminderEvents = ['PROOF', 'REVIEW_REMINDER'] as const;
const REVIEW_REMINDER_COOLDOWN_MS = 10 * 60 * 1000;

@Injectable()
export class ManualExchangeService {
  private readonly settlementHold: SettlementHoldService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly rateService: RateService,
    private readonly ledger: LedgerService,
    private readonly pin: TransactionPinService,
    private readonly storage: SupabaseService,
    private readonly logger: PinoLogger,
    @Optional() settlementHold?: SettlementHoldService,
  ) {
    this.settlementHold = settlementHold ?? new SettlementHoldService(prisma);
  }

  configuration() {
    const availableSourceCurrencies = (['GHS', 'NGN'] as const).filter(
      (currency) => {
        if (!this.enabled()) return false;
        try {
          this.collection(currency);
          return true;
        } catch (error) {
          if (error instanceof ServiceUnavailableException) return false;
          throw error;
        }
      },
    );
    const sourceCurrency = availableSourceCurrencies[0] ?? 'GHS';
    return {
      enabled: availableSourceCurrencies.length > 0,
      sourceCurrency,
      targetCurrency: sourceCurrency === 'GHS' ? 'NGN' : 'GHS',
      availableSourceCurrencies,
      supportedSourceCurrencies: ['GHS', 'NGN'],
      deliveryPolicyVersion: 2,
      exchangeLimitPolicy: 'UNLIMITED',
      reviewRemindersEnabled: true,
      settlementOptions: {
        GHS: manualDeliveryOptions('GHS'),
        NGN: manualDeliveryOptions('NGN'),
      },
    };
  }
  private enabled() {
    return (
      String(this.config.get('MANUAL_EXCHANGE_ENABLED', 'false')) === 'true'
    );
  }
  private requireEnabled() {
    if (!this.enabled())
      throw new ServiceUnavailableException(
        'Manual exchange is currently unavailable',
      );
  }
  private key(value: string) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
      throw new BadRequestException('A valid Idempotency-Key is required');
    return hash(value);
  }
  private async eligible(
    userId: string,
    settlementMode?: ManualExchangeSettlement,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { isSuspended: true, kycStatus: true, kycTier: true },
    });
    if (!user) throw new NotFoundException('Account not found');
    if (user.isSuspended) throw new ForbiddenException('Account is suspended');
    if (
      settlementMode === 'WALLET' &&
      (user.kycStatus !== 'VERIFIED' ||
        !isKycTierAtLeast(user.kycTier, 'TIER_1'))
    )
      throw new ForbiddenException(
        'Verify your identity before crediting your wallet',
      );
  }
  private collection(currency: 'NGN' | 'GHS' = 'NGN') {
    const prefix =
      currency === 'NGN'
        ? 'MANUAL_EXCHANGE_COLLECTION_'
        : 'MANUAL_EXCHANGE_GHS_COLLECTION_';
    const values = {
      bankName: this.config.get<string>(`${prefix}BANK_NAME`, ''),
      accountName: this.config.get<string>(`${prefix}ACCOUNT_NAME`, ''),
      accountNumber: this.config.get<string>(`${prefix}ACCOUNT_NUMBER`, ''),
      version: this.config.get<string>(`${prefix}VERSION`, ''),
      currency,
    };
    if (
      !values.bankName.trim() ||
      !values.accountName.trim() ||
      !/^\d{10}$/.test(values.accountNumber) ||
      !values.version.trim()
    )
      throw new ServiceUnavailableException(
        'Exchange receiving account is not configured',
      );
    return values;
  }
  async create(
    userId: string,
    dto: CreateManualExchangeDto,
    key: string,
    auditContext?: RequestAuditContext,
  ) {
    const sourceCurrency = dto.sourceCurrency ?? 'NGN';
    const targetCurrency = sourceCurrency === 'NGN' ? 'GHS' : 'NGN';
    // Replaying a committed order only returns its existing instructions.
    await this.eligible(userId);
    await this.pin.verifyRequired(userId, dto.transactionPin);
    const keyHash = this.key(key);
    const business = {
      ...(sourceCurrency === 'GHS' ? { sourceCurrency } : {}),
      amount: dto.amount,
      settlementMode: dto.settlementMode,
      destinationInstitution: dto.destinationInstitution,
      destinationAccount: dto.destinationAccount,
      destinationName: dto.destinationName,
      ...(dto.deliveryPolicyVersion !== undefined
        ? { deliveryPolicyVersion: dto.deliveryPolicyVersion }
        : {}),
    };
    const fingerprint = requestHash(business);
    const existing = await this.prisma.manualExchangeOrder.findUnique({
      where: { userId_createKeyHash: { userId, createKeyHash: keyHash } },
      include,
    });
    if (existing) {
      if (existing.createRequestHash !== fingerprint)
        throw new ConflictException(
          'Attempt already used for different exchange details',
        );
      return this.present(existing);
    }
    this.requireEnabled();
    assertManualDelivery(sourceCurrency, dto.settlementMode);
    if (sourceCurrency === 'GHS' && dto.deliveryPolicyVersion !== 2)
      throw new BadRequestException(
        'Update your app to choose a Nigerian bank account for this exchange',
      );
    if (
      sourceCurrency === 'GHS' &&
      !/^\d{10}$/.test(dto.destinationAccount ?? '')
    )
      throw new BadRequestException(
        'Enter a ten-digit Nigerian bank account number',
      );
    if (
      dto.settlementMode === 'WALLET' &&
      !(await this.prisma.wallet.findUnique({
        where: { userId_currency: { userId, currency: targetCurrency } },
        select: { id: true },
      }))
    )
      throw new ConflictException(
        `Set up your ${targetCurrency} wallet before creating a wallet exchange`,
      );
    if (
      dto.settlementMode === 'WALLET' &&
      (dto.destinationAccount ||
        dto.destinationInstitution ||
        dto.destinationName)
    )
      throw new BadRequestException(
        'Wallet settlement cannot include external account details',
      );
    const collection = this.collection(sourceCurrency);
    // A receiving address that auto-funds a user wallet would settle the deposit twice.
    if (
      await this.prisma.virtualAccount.findFirst({
        where: { accountNumber: collection.accountNumber },
        select: { id: true },
      })
    )
      throw new ServiceUnavailableException(
        'Exchange requires a dedicated collection account',
      );
    const live = await this.rateService.getRate(sourceCurrency, targetCurrency);
    if (live.isStale)
      throw new ServiceUnavailableException(
        'A fresh exchange rate is required',
      );
    const quote = quoteManualExchange(
      dto.amount,
      String(live.rate),
      String(live.markup),
    );
    const reference = `MEX-${randomUUID().toUpperCase()}`;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          // Serialize duplicate attempts and recheck eligibility without requiring a wallet.
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
          await this.eligible(userId, dto.settlementMode, tx);
          const replay = await tx.manualExchangeOrder.findUnique({
            where: { userId_createKeyHash: { userId, createKeyHash: keyHash } },
            include,
          });
          if (replay) {
            if (replay.createRequestHash !== fingerprint)
              throw new ConflictException(
                'Attempt already used for different exchange details',
              );
            return replay;
          }
          // Use database time for the order and expiry, independent of app-server clock drift.
          const [clock] = await tx.$queryRaw<
            Array<{ now: Date }>
          >`SELECT clock_timestamp() AS "now"`;
          const createdAt = clock.now;
          const transaction = await tx.transaction.create({
            data: {
              userId,
              type: 'EXCHANGE',
              currency: sourceCurrency,
              amount: quote.amount,
              fee: quote.fee,
              reference,
              createdAt,
              metadata: {
                flow: 'MANUAL_EXCHANGE',
                ...auditContext,
                settlementMode: dto.settlementMode,
                targetCurrency,
                targetAmount: quote.targetAmount,
              },
            },
          });
          return tx.manualExchangeOrder.create({
            data: {
              userId,
              transactionId: transaction.id,
              reference,
              createKeyHash: keyHash,
              createRequestHash: fingerprint,
              settlementMode: dto.settlementMode,
              payoutWorkflow:
                sourceCurrency === 'NGN' && dto.settlementMode !== 'WALLET'
                  ? 'ADMIN_CEDIS'
                  : 'ADMIN_EXTERNAL',
              ...quote,
              sourceCurrency,
              targetCurrency,
              collectionAccount: collection,
              destinationInstitution: dto.destinationInstitution?.trim(),
              destinationAccount: dto.destinationAccount?.trim(),
              destinationName: dto.destinationName?.trim(),
              createdAt,
              expiresAt: new Date(createdAt.getTime() + 30 * 60 * 1000),
              events: {
                create: {
                  actorId: userId,
                  action: 'CREATE',
                  keyHash,
                  requestHash: fingerprint,
                  status: 'AWAITING_TRANSFER',
                  createdAt,
                  reason: 'Exchange instructions created',
                },
              },
            },
            include,
          });
        },
        { timeout: 5000 },
      );
      this.logger.info(
        { orderId: result.id },
        'Manual exchange instructions created',
      );
      return this.present(result);
    } catch (error) {
      if (this.isUnique(error)) {
        const replay = await this.prisma.manualExchangeOrder.findUnique({
          where: { userId_createKeyHash: { userId, createKeyHash: keyHash } },
          include,
        });
        if (replay?.createRequestHash === fingerprint)
          return this.present(replay);
        throw new ConflictException(
          'This exchange attempt is already recorded',
        );
      }
      throw error;
    }
  }
  async recoverCreated(userId: string, key: string) {
    const createKeyHash = this.key(key);
    const order = await this.prisma.manualExchangeOrder.findUnique({
      where: { userId_createKeyHash: { userId, createKeyHash } },
      include,
    });
    if (!order) throw new NotFoundException('Exchange request not found');
    return this.present(order);
  }

  async queue(input: { status?: ManualStatus; cursor?: string } = {}) {
    const { rows, groups } = await this.prisma.$transaction(
      async (tx) => {
        // Resolve the immutable boundary independently of its mutable status.
        const anchor = input.cursor
          ? await tx.manualExchangeOrder.findUnique({
              where: { id: input.cursor },
              select: { createdAt: true, id: true },
            })
          : null;
        if (input.cursor && !anchor)
          throw new BadRequestException(
            'Queue position no longer exists. Refresh the queue.',
          );
        const rows = await tx.manualExchangeOrder.findMany({
          where: {
            ...(input.status ? { status: input.status } : {}),
            ...(anchor
              ? {
                  OR: [
                    { createdAt: { lt: anchor.createdAt } },
                    { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 51,
          include,
        });
        const groups = await tx.manualExchangeOrder.groupBy({
          by: ['status'],
          _count: { _all: true },
        });
        return { rows, groups };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 5000,
      },
    );
    const page = rows.slice(0, 50);
    return {
      items: page.map((row) => this.present(row, true)),
      nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
      counts: Object.fromEntries(
        groups.map((group) => [group.status, group._count._all]),
      ),
    };
  }
  async list(userId?: string, status?: ManualStatus) {
    const rows = await this.prisma.manualExchangeOrder.findMany({
      where: { ...(userId ? { userId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: userId ? 50 : 100,
      include,
    });
    return rows.map((row) => this.present(row, !userId));
  }
  private async find(
    id: string,
    userId?: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await tx.manualExchangeOrder.findFirst({
      where: { id, ...(userId ? { userId } : {}) },
      include,
    });
    if (!row) throw new NotFoundException('Exchange order not found');
    return row;
  }
  async get(id: string, userId: string) {
    return this.present(await this.find(id, userId));
  }

  /**
   * The customer can nudge operations only after submitting proof and while
   * the order is waiting for an admin decision. This deliberately does not
   * change any financial or payout field; the version bump is the optimistic
   * claim that serializes competing reminder requests on the order row.
   */
  async remind(
    id: string,
    userId: string,
    dto: ManualExchangeReminderDto,
    key: string,
    auditContext?: RequestAuditContext,
  ) {
    const keyHash = this.key(key);
    const fingerprint = requestHash(dto);
    const result = await this.mutate(async (tx) => {
      const row = await this.find(id, userId, tx);
      const replay = await this.replay(
        tx,
        id,
        userId,
        'REVIEW_REMINDER',
        keyHash,
        fingerprint,
      );
      if (replay) return this.reviewReminderResponse(replay.createdAt);

      if (!row.proofKey)
        throw new ConflictException(
          'Submit transfer proof before requesting an exchange review reminder',
        );
      if (!(reviewReminderStatuses as readonly string[]).includes(row.status))
        throw new ConflictException(
          'A review reminder is not available in this exchange state',
        );

      const nextAllowedAt = this.reviewReminderNextAllowedAt(row);
      if (nextAllowedAt)
        throw new HttpException(
          {
            message: 'Please wait before requesting another review reminder',
            nextAllowedAt: nextAllowedAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );

      await this.claimVersion(tx, row, { status: row.status });
      const event = await this.event(
        tx,
        row.id,
        userId,
        'REVIEW_REMINDER',
        keyHash,
        fingerprint,
        row.status,
        dto.reason,
      );
      await tx.paymentNotification.create({
        data: {
          eventKey: `manual-exchange:${row.id}:review-reminder:${keyHash}`,
          audience: 'ADMIN',
          orderId: row.id,
          title: `Exchange review requested again: ${row.reference}.`,
        },
      });
      return this.reviewReminderResponse(event.createdAt);
    });

    this.logger?.info?.(
      {
        orderId: id,
        userId,
        event: 'manual_exchange_review_reminder',
        requestedAt: result.requestedAt,
        nextAllowedAt: result.nextAllowedAt,
        ...auditContext,
      },
      'Manual exchange review reminder requested',
    );
    return result;
  }

  private reviewReminderResponse(requestedAt: Date) {
    const requestedAtIso = new Date(requestedAt).toISOString();
    return {
      requestedAt: requestedAtIso,
      nextAllowedAt: new Date(
        new Date(requestedAt).getTime() + REVIEW_REMINDER_COOLDOWN_MS,
      ).toISOString(),
    };
  }

  private reviewReminderNextAllowedAt(row: Pick<Order, 'events'>) {
    const latest = row.events
      .filter((event) =>
        (reviewReminderEvents as readonly string[]).includes(event.action),
      )
      .reduce<
        (typeof row.events)[number] | null
      >((current, event) => (!current || event.createdAt > current.createdAt ? event : current), null);
    if (!latest) return null;
    const nextAllowedAt = new Date(
      latest.createdAt.getTime() + REVIEW_REMINDER_COOLDOWN_MS,
    );
    return nextAllowedAt > new Date() ? nextAllowedAt : null;
  }

  private bucket() {
    return this.config.get<string>(
      'EXCHANGE_RECEIPT_BUCKET',
      'exchange-receipts',
    );
  }

  async uploadUrl(
    id: string,
    actorId: string,
    dto: ManualProofUploadDto,
    key: string,
    admin = false,
    handover = false,
  ) {
    const row = await this.find(id, admin ? undefined : actorId);
    const ownsPayoutClaim =
      row.status === 'PAYOUT_PROCESSING' && row.payoutClaimedBy === actorId;
    const mayPrepareHandoverEvidence =
      handover &&
      row.status === 'PAYOUT_PROCESSING' &&
      !!row.payoutClaimedBy &&
      row.payoutClaimedBy !== actorId;
    if (
      admin
        ? !ownsPayoutClaim && !mayPrepareHandoverEvidence
        : !proofOpen.includes(row.status)
    )
      throw new ConflictException(
        'Proof upload is not available in this state',
      );
    if (
      !proofTypes[dto.contentType] ||
      !Number.isInteger(dto.fileSize) ||
      dto.fileSize <= 0 ||
      dto.fileSize > 8 * 1024 * 1024
    )
      throw new BadRequestException('Use an image or PDF no larger than 8MB');
    const kind = admin ? 'PAYOUT' : 'DEPOSIT';
    const uploadKeyHash = this.key(key),
      uploadRequestHash = requestHash(dto);
    const where = {
      orderId_actorId_kind_uploadKeyHash: {
        orderId: id,
        actorId,
        kind,
        uploadKeyHash,
      },
    };
    let proof = await this.prisma.manualExchangeProof.findUnique({ where });
    if (!proof) {
      try {
        proof = await this.prisma.manualExchangeProof.create({
          data: {
            orderId: id,
            actorId,
            kind,
            uploadKeyHash,
            uploadRequestHash,
            objectKey: `manual-exchange/${row.id}/${kind.toLowerCase()}/${randomUUID()}.${proofTypes[dto.contentType]}`,
            contentType: dto.contentType,
            fileSize: dto.fileSize,
          },
        });
      } catch (error) {
        if (!this.isUnique(error)) throw error;
        proof = await this.prisma.manualExchangeProof.findUniqueOrThrow({
          where,
        });
      }
    }
    if (proof.uploadRequestHash !== uploadRequestHash)
      throw new ConflictException(
        'Upload attempt already used for a different file',
      );
    const objectKey = proof.objectKey;
    try {
      const signed = await this.storage.createSignedUploadUrl(
        this.bucket(),
        objectKey,
      );
      return { signedUrl: signed.signedUrl, objectKey, token: signed.token };
    } catch {
      throw new ServiceUnavailableException(
        'Receipt upload is temporarily unavailable',
      );
    }
  }

  async uploadHandoverUrl(
    id: string,
    actorId: string,
    dto: ManualProofUploadDto,
    key: string,
  ) {
    return this.uploadUrl(id, actorId, dto, key, true, true);
  }

  private async verifyProof(
    id: string,
    actorId: string,
    objectKey: string,
    kind: string,
  ) {
    const proof = await this.prisma.manualExchangeProof.findFirst({
      where: { orderId: id, actorId, objectKey, kind },
    });
    if (!proof)
      throw new BadRequestException('Receipt does not belong to this order');
    const bucket = this.storage.getAdminClient().storage.from(this.bucket());
    // Verify actual object metadata and signature; never trust the signed-upload request.
    const info = await bucket.info(objectKey);
    if (
      info.error ||
      !info.data ||
      info.data.size !== proof.fileSize ||
      info.data.size > 8 * 1024 * 1024
    )
      throw new BadRequestException(
        'Uploaded receipt is missing or its size is invalid',
      );
    const downloaded = await bucket.download(objectKey);
    if (
      downloaded.error ||
      !downloaded.data ||
      downloaded.data.size !== proof.fileSize
    )
      throw new BadRequestException('Uploaded receipt could not be verified');
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    const signatureOk =
      proof.contentType === 'application/pdf'
        ? bytes.subarray(0, 5).toString() === '%PDF-'
        : proof.contentType === 'image/png'
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : proof.contentType === 'image/jpeg'
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP';
    if (!signatureOk)
      throw new BadRequestException(
        'Receipt contents do not match the file type',
      );
  }
  private async replay(
    tx: Prisma.TransactionClient,
    id: string,
    actorId: string,
    action: string,
    keyHash: string,
    fingerprint: string,
  ) {
    const event = await tx.manualExchangeEvent.findUnique({
      where: {
        orderId_actorId_action_keyHash: {
          orderId: id,
          actorId,
          action,
          keyHash,
        },
      },
    });
    if (event && event.requestHash !== fingerprint)
      throw new ConflictException(
        'Attempt already used with different details',
      );
    return event;
  }
  async attach(
    id: string,
    userId: string,
    dto: AttachManualProofDto,
    key: string,
  ) {
    const keyHash = this.key(key),
      fingerprint = requestHash(dto);
    await this.find(id, userId);
    await this.verifyProof(id, userId, dto.objectKey, 'DEPOSIT');
    return this.mutate(async (tx) => {
      const row = await this.find(id, userId, tx);
      if (await this.replay(tx, id, userId, 'PROOF', keyHash, fingerprint))
        return this.present(row);
      if (!proofOpen.includes(row.status))
        throw new ConflictException('This exchange can no longer accept proof');
      await this.claimVersion(tx, row, {
        status: 'AWAITING_CONFIRMATION',
        proofKey: dto.objectKey,
        bankReference: dto.bankReference,
        reviewReason:
          row.expiresAt < new Date()
            ? 'Transfer instructions expired. Your receipt requires review; quoted terms have not changed.'
            : null,
      });
      await this.event(
        tx,
        row.id,
        userId,
        'PROOF',
        keyHash,
        fingerprint,
        'AWAITING_CONFIRMATION',
        'Customer submitted transfer proof',
      );
      await tx.paymentNotification.createMany({
        data: [
          {
            eventKey: `manual-exchange:${row.id}:payment-submitted:${fingerprint}`,
            audience: 'ADMIN',
            orderId: row.id,
            title: `Exchange payment submitted: ${row.amount.toFixed(2)} ${row.sourceCurrency}. Review ${row.reference}.`,
          },
        ],
        skipDuplicates: true,
      });
      return this.present(await this.find(id, userId, tx));
    });
  }

  private async assertActiveAdmin(
    tx: Prisma.TransactionClient,
    adminId: string,
    currentOwnerId: string,
  ) {
    if (adminId === currentOwnerId)
      throw new ConflictException(
        'Choose an admin other than the current payout owner',
      );
    const target = await tx.user.findUnique({
      where: { id: adminId },
      select: { role: true, isSuspended: true },
    });
    if (!target || target.role !== 'ADMIN' || target.isSuspended)
      throw new ForbiddenException(
        'Handover target must be an active administrator',
      );
  }

  private exactPayoutAmount(
    value: string | undefined,
    expected: Decimal,
  ): boolean {
    if (!value) return false;
    try {
      const amount = new Decimal(value);
      return amount.isFinite() && amount.eq(expected);
    } catch {
      return false;
    }
  }

  async review(
    id: string,
    adminId: string,
    dto: ReviewManualExchangeDto,
    key: string,
    auditContext?: RequestAuditContext,
  ) {
    const keyHash = this.key(key),
      fingerprint = requestHash(dto);
    // A committed replay is a read of financial facts. It must survive storage outages.
    if (
      await this.replay(
        this.prisma,
        id,
        adminId,
        dto.action,
        keyHash,
        fingerprint,
      )
    )
      return this.present(await this.find(id), true);
    if (
      ['MARK_SENT', 'RECORD_CEDIS_SENT', 'RECORD_PAYOUT_SENT'].includes(
        dto.action,
      )
    ) {
      if (!dto.payoutProofObjectKey)
        throw new BadRequestException('Payout evidence is required');
      await this.verifyProof(id, adminId, dto.payoutProofObjectKey, 'PAYOUT');
    }
    if (dto.action === 'HANDOVER_PAYOUT') {
      if (!dto.payoutOutcome)
        throw new BadRequestException(
          'Classify the real bank or MoMo payout outcome before handing over',
        );
      if (!dto.handoverToAdminId)
        throw new BadRequestException(
          'An active administrator is required to receive the payout claim',
        );
      if (dto.payoutOutcome === 'UNKNOWN')
        throw new ConflictException(
          'The external payout outcome is unknown. Do not reassign or send again; reconcile the original claim first',
        );
      if (!dto.payoutProofObjectKey)
        throw new BadRequestException(
          'Protected evidence of the checked payout outcome is required',
        );
      await this.verifyProof(id, adminId, dto.payoutProofObjectKey, 'PAYOUT');
      if (dto.payoutOutcome === 'ALREADY_SENT' && !dto.payoutReference)
        throw new BadRequestException(
          'The confirmed payout reference is required when the payout was already sent',
        );
    }
    return this.mutate(async (tx) => {
      // Serialize review and committed replay before evaluating a new transition.
      await tx.$queryRaw`SELECT "id" FROM "manual_exchange_orders" WHERE "id" = ${id} FOR UPDATE`;
      const row = await this.find(id, undefined, tx);
      if (await this.replay(tx, id, adminId, dto.action, keyHash, fingerprint))
        return this.present(row, true);
      if (
        dto.action === 'RECORD_CEDIS_SENT' &&
        (row.sourceCurrency !== 'NGN' ||
          row.targetCurrency !== 'GHS' ||
          row.settlementMode === 'WALLET')
      )
        throw new BadRequestException(
          'This action records only a manual cedi transfer for a naira-to-cedi order',
        );
      if (
        dto.action === 'RECORD_CEDIS_SENT' &&
        (!dto.payoutAmount ||
          !new Decimal(dto.payoutAmount).eq(row.targetAmount))
      )
        throw new BadRequestException(
          'The cedis sent must match the frozen payout amount',
        );
      if (
        row.payoutWorkflow === 'ADMIN_CEDIS' &&
        (dto.action === 'MARK_SENT' ||
          (dto.action === 'COMPLETE' && row.status !== 'PAYOUT_SENT'))
      )
        throw new ConflictException(
          'Use Confirm cedis sent with the actual cedi amount for this order',
        );
      if (
        dto.action === 'COMPLETE' &&
        row.payoutWorkflow !== 'LEGACY' &&
        (!row.payoutReference ||
          !row.payoutProofKey ||
          !row.payoutClaimedBy ||
          !row.events.some(
            (event) =>
              event.action === 'HANDOVER_PAYOUT' &&
              event.status === 'PAYOUT_SENT',
          ))
      )
        throw new ConflictException(
          'Complete only an independently verified already-sent payout handover',
        );
      if (dto.action === 'RECORD_PAYOUT_SENT') {
        if (
          row.payoutWorkflow !== 'ADMIN_EXTERNAL' ||
          row.settlementMode === 'WALLET'
        )
          throw new BadRequestException(
            'This action records only a direct-account exchange payout',
          );
        if (!this.exactPayoutAmount(dto.payoutAmount, row.targetAmount))
          throw new BadRequestException(
            'The amount sent must match the frozen payout amount',
          );
      }
      if (
        row.payoutWorkflow === 'ADMIN_EXTERNAL' &&
        ['MARK_SENT', 'RECORD_CEDIS_SENT'].includes(dto.action)
      )
        throw new ConflictException(
          'Record the actual payout with its exact amount and protected evidence',
        );
      let next: ManualStatus;
      const update: Prisma.ManualExchangeOrderUpdateManyMutationInput = {
        status: row.status,
        reviewReason: dto.reason,
      };
      if (dto.action === 'HANDOVER_PAYOUT') {
        if (!row.payoutClaimedBy)
          throw new ConflictException(
            'Only an actively owned payout can be handed over',
          );
        if (row.payoutReference || row.payoutProofKey)
          throw new ConflictException(
            'Payout evidence is already recorded. Refresh the order before taking another action',
          );
        const outcome = dto.payoutOutcome as ManualPayoutOutcome;
        await this.assertActiveAdmin(
          tx,
          dto.handoverToAdminId as string,
          row.payoutClaimedBy,
        );
        next = nextManualPayoutHandoverStatus(
          row.status,
          row.settlementMode,
          outcome,
        );
        if (outcome !== 'ALREADY_SENT') {
          await this.eligible(row.userId, row.settlementMode, tx);
          const credential = await tx.transactionPinCredential.findUnique({
            where: { userId: row.userId },
            select: { resetHoldUntil: true },
          });
          if (
            credential?.resetHoldUntil &&
            credential.resetHoldUntil > new Date()
          )
            throw new ForbiddenException(
              'Payout is paused while the customer transaction PIN reset hold is active',
            );
          for (const currency of [row.sourceCurrency, row.targetCurrency])
            await this.settlementHold.assertSettlementAllowed(
              {
                operation: 'MANUAL_EXCHANGE',
                scope: 'MANUAL_EXCHANGE',
                currency,
                provider: 'MANUAL_ADMIN',
                reference: row.reference,
              },
              tx,
            );
        } else {
          if (
            !this.exactPayoutAmount(dto.payoutAmount, row.targetAmount) ||
            !dto.payoutProofObjectKey
          )
            throw new BadRequestException(
              'Record the exact frozen payout amount and protected evidence for an already-sent payout',
            );
          update.payoutReference = dto.payoutReference!.trim().toUpperCase();
          update.payoutProofKey = dto.payoutProofObjectKey;
        }
        update.status = next;
        update.payoutClaimedBy = dto.handoverToAdminId;
      } else {
        next = nextManualExchangeStatus(
          row.status,
          row.settlementMode,
          dto.action,
        );
        update.status = next;
      }
      if (dto.action === 'CREDIT_WALLET' || dto.action === 'CONFIRM_DEPOSIT') {
        this.requireEnabled();
        await this.eligible(row.userId, row.settlementMode, tx);
        if (!row.proofKey)
          throw new ConflictException('Customer proof is required');
        if (row.expiresAt < new Date() && dto.acceptExpiredQuote !== true)
          throw new ConflictException(
            'This quote expired. Explicitly accept the original quoted terms before confirming the deposit',
          );
        if (
          !dto.depositReference ||
          !dto.actualAmount ||
          !new Decimal(dto.actualAmount).equals(row.amount)
        )
          throw new BadRequestException(
            'Verify the exact received amount and bank reference before confirming',
          );
        const reference = await allocateDepositReference(tx, {
          reference: dto.depositReference,
          settlementId: row.id,
          amount: row.amount,
          kind: 'EXCHANGE',
        });
        update.depositReference = reference;
      }
      if (dto.action === 'CLAIM_PAYOUT') {
        await this.eligible(row.userId, row.settlementMode, tx);
        const credential = await tx.transactionPinCredential.findUnique({
          where: { userId: row.userId },
          select: { resetHoldUntil: true },
        });
        if (
          credential?.resetHoldUntil &&
          credential.resetHoldUntil > new Date()
        )
          throw new ForbiddenException(
            'Payout is paused while the customer transaction PIN reset hold is active',
          );
        for (const currency of [row.sourceCurrency, row.targetCurrency])
          await this.settlementHold.assertSettlementAllowed(
            {
              operation: 'MANUAL_EXCHANGE',
              scope: 'MANUAL_EXCHANGE',
              currency,
              provider: 'MANUAL_ADMIN',
              reference: row.reference,
            },
            tx,
          );
        update.payoutClaimedBy = adminId;
      }
      if (
        ['MARK_SENT', 'RECORD_CEDIS_SENT', 'RECORD_PAYOUT_SENT'].includes(
          dto.action,
        )
      ) {
        if (row.payoutClaimedBy !== adminId)
          throw new ForbiddenException(
            'Only the assigned payout operator can record this payment',
          );
        if (!dto.payoutReference)
          throw new BadRequestException('Actual payout reference is required');

        await this.settlementHold.assertSettlementAllowed(
          {
            operation: 'MANUAL_EXCHANGE',
            scope: 'MANUAL_EXCHANGE',
            currency: row.sourceCurrency,
            provider: 'MANUAL_ADMIN',
            reference: row.reference,
          },
          tx,
        );
        if (
          dto.action === 'RECORD_CEDIS_SENT' ||
          dto.action === 'RECORD_PAYOUT_SENT'
        )
          await this.settlementHold.assertSettlementAllowed(
            {
              operation: 'MANUAL_EXCHANGE',
              scope: 'MANUAL_EXCHANGE',
              currency: row.targetCurrency,
              provider: 'MANUAL_ADMIN',
              reference: row.reference,
            },
            tx,
          );
        update.payoutReference = dto.payoutReference.trim().toUpperCase();
        update.payoutProofKey = dto.payoutProofObjectKey;
      }
      await this.claimVersion(tx, row, update);
      if (next === 'CREDITED') {
        await this.ledger.creditWallet(
          {
            userId: row.userId,
            currency: row.targetCurrency,
            amount: new Decimal(row.targetAmount),
            transactionId: row.transactionId,
            reference: row.reference,
            source: 'MANUAL_EXCHANGE_ORDER_CREDIT',
            metadata: {
              orderId: row.id,
              depositReference: update.depositReference,
            },
          },
          tx,
        );
      }
      if (next === 'CREDITED' || next === 'COMPLETED' || next === 'REJECTED')
        await tx.transaction.update({
          where: { id: row.transactionId },
          data: { status: next === 'REJECTED' ? 'FAILED' : 'SUCCESS' },
        });
      await this.event(
        tx,
        id,
        adminId,
        dto.action,
        keyHash,
        fingerprint,
        next,
        dto.action === 'HANDOVER_PAYOUT'
          ? `Payout handover outcome ${dto.payoutOutcome}: ${dto.reason}`
          : dto.reason,
      );
      await tx.auditLog.create({
        data: {
          adminId,
          action: `MANUAL_EXCHANGE_${dto.action}`,
          targetType: 'ManualExchangeOrder',
          targetId: id,
          reference: row.reference,
          reason: dto.reason,
          before: {
            status: row.status,
            ...(dto.action === 'HANDOVER_PAYOUT'
              ? { payoutClaimedBy: row.payoutClaimedBy }
              : {}),
          },
          after: {
            status: next,
            settlementMode: row.settlementMode,
            ...(dto.action === 'HANDOVER_PAYOUT'
              ? {
                  payoutClaimedBy: dto.handoverToAdminId,
                  payoutOutcome: dto.payoutOutcome,
                }
              : {}),
          },
          metadata: {
            ...auditContext,
            amount: row.amount.toFixed(2),
            targetAmount: row.targetAmount.toFixed(2),
            ...(dto.payoutAmount
              ? { recordedPayoutAmount: dto.payoutAmount }
              : {}),
            ...(dto.acceptExpiredQuote === true
              ? {
                  acceptedExpiredQuote: true,
                  originalExpiresAt: row.expiresAt.toISOString(),
                }
              : {}),
            ...(dto.action === 'HANDOVER_PAYOUT'
              ? {
                  handoverToAdminId: dto.handoverToAdminId,
                  payoutOutcome: dto.payoutOutcome,
                  previousOwnerId: row.payoutClaimedBy,
                }
              : {}),
          },
        },
      });
      const customerNotification =
        next === 'CREDITED'
          ? {
              event: 'completed',
              title: `Payment confirmed. ${row.targetAmount.toFixed(2)} ${row.targetCurrency} added to your TrustPay wallet. ${row.reference}`,
            }
          : dto.action === 'CONFIRM_DEPOSIT'
            ? {
                event: 'payment-confirmed',
                title: `Payment confirmed. We are preparing your ${row.targetCurrency} payout. ${row.reference}`,
              }
            : next === 'COMPLETED'
              ? {
                  event: 'completed',
                  title: `Payout complete: ${row.targetAmount.toFixed(2)} ${row.targetCurrency} sent. ${row.reference}`,
                }
              : null;
      if (customerNotification)
        await tx.paymentNotification.createMany({
          data: [
            {
              eventKey: `manual-exchange:${row.id}:${customerNotification.event}`,
              audience: `USER:${row.userId}`,
              orderId: row.id,
              title: customerNotification.title,
            },
          ],
          skipDuplicates: true,
        });
      return this.present(await this.find(id, undefined, tx), true);
    });
  }
  private async claimVersion(
    tx: Prisma.TransactionClient,
    row: ManualExchangeOrder,
    data: Prisma.ManualExchangeOrderUpdateManyMutationInput,
  ) {
    const claimed = await tx.manualExchangeOrder.updateMany({
      where: { id: row.id, version: row.version, status: row.status },
      data: { ...data, version: { increment: 1 } },
    });
    if (claimed.count !== 1)
      throw new ConflictException(
        'Order changed. Refresh its status before continuing',
      );
  }
  private event(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
    action: string,
    keyHash: string,
    fingerprint: string,
    status: ManualStatus,
    reason: string,
  ) {
    return tx.manualExchangeEvent.create({
      data: {
        orderId,
        actorId,
        action,
        keyHash,
        requestHash: fingerprint,
        status,
        reason,
      },
    });
  }
  private async mutate<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(operation, { timeout: 5000 });
    } catch (error) {
      if (this.isUnique(error))
        throw new ConflictException(
          'This deposit, payout or action is already recorded. Refresh the order',
        );
      throw error;
    }
  }
  private isUnique(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
  async proofUrl(
    id: string,
    actorId: string,
    admin = false,
    kind: 'DEPOSIT' | 'PAYOUT' = 'DEPOSIT',
  ) {
    const row = await this.find(id, admin ? undefined : actorId);
    const objectKey = kind === 'PAYOUT' ? row.payoutProofKey : row.proofKey;
    if (!objectKey) throw new NotFoundException('Receipt is not available');
    if (admin)
      await this.prisma.auditLog.create({
        data: {
          adminId: actorId,
          action: 'MANUAL_EXCHANGE_PROOF_VIEW',
          targetType: 'ManualExchangeOrder',
          targetId: id,
          reason: `Viewed ${kind.toLowerCase()} proof`,
        },
      });
    return {
      url: await this.storage.createSignedReadUrl(
        this.bucket(),
        objectKey,
        300,
      ),
    };
  }
  private present(row: Order, admin = false) {
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      settlementMode: row.settlementMode,
      payoutWorkflow: row.payoutWorkflow,
      sourceCurrency: row.sourceCurrency,
      targetCurrency: row.targetCurrency,
      amount: row.amount.toFixed(2),
      targetAmount: row.targetAmount.toFixed(2),
      rate: row.rate.toFixed(6),
      fee: row.fee.toFixed(2),
      collectionAccount: row.collectionAccount,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      reviewReason: row.reviewReason,
      destinationInstitution: row.destinationInstitution,
      destinationAccountMasked: row.destinationAccount
        ? `***${row.destinationAccount.slice(-4)}`
        : null,
      destinationName: row.destinationName,
      bankReference: row.bankReference,
      depositReference: row.depositReference,
      payoutReference: row.payoutReference,
      payoutClaimedBy: row.payoutClaimedBy,
      hasProof: !!row.proofKey,
      hasPayoutProof: !!row.payoutProofKey,
      reviewRemindersEnabled: true,
      reviewReminderNextAllowedAt:
        this.reviewReminderNextAllowedAt(row)?.toISOString() ?? null,
      events: row.events.map((event) => ({
        status: event.status,
        reason: event.reason,
        createdAt: event.createdAt,
      })),
      ...(admin
        ? { userId: row.userId, destinationAccount: row.destinationAccount }
        : {}),
    };
  }
}
