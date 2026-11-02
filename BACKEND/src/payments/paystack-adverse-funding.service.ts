import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FundingAdverseCaseStatus,
  FundingAdverseVerificationStatus,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PaystackClient } from '../paystack/paystack.client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';

export const PAYSTACK_ADVERSE_EVENT_TYPES = [
  'charge.dispute.create',
  'charge.dispute.resolve',
  'refund.processed',
] as const;

export type PaystackAdverseEventType =
  (typeof PAYSTACK_ADVERSE_EVENT_TYPES)[number];

export interface PaystackAdverseEventInput {
  eventType: PaystackAdverseEventType;
  providerReference: string;
  data: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}

export type PaystackAdverseResolutionAction = 'RELEASE_HOLD' | 'COLLECT';

export interface PaystackAdverseResolutionInput {
  action: PaystackAdverseResolutionAction;
  reason: string;
  /** Required for COLLECT. There is deliberately no implicit full debit. */
  amount?: string;
  /** The request idempotency key, bound to one explicit collection operation. */
  operationKey?: string;
}

export interface PaystackAdverseRecheckInput {
  reason: string;
  /** The request idempotency key for this read/verify/update operation. */
  operationKey?: string;
}

type ProviderTransaction = {
  id?: string | number;
  reference?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  domain?: string;
  customer?: { customer_code?: string };
};

type ProviderRefund = {
  id?: string | number;
  status?: string;
  amount?: number | string;
  currency?: string;
  domain?: string;
  transaction?: string | number | { id?: string | number; reference?: string };
  transaction_reference?: string;
};

type ProviderDispute = {
  id?: string | number;
  status?: string;
  resolution?: string;
  currency?: string;
  domain?: string;
  transaction?: {
    reference?: string;
    amount?: number | string;
    currency?: string;
    domain?: string;
  };
};

type LocalFundingTransaction = {
  id: string;
  userId: string;
  type: string;
  status: string;
  reference: string;
  amount: Decimal;
  currency: string;
  metadata: Prisma.JsonValue | null;
};

type AdverseCaseLike = {
  id: string;
  status: string;
  verificationStatus: string;
  holdRequired: boolean;
  economicReference?: string | null;
  exposureAmount?: Decimal | null;
  recoveredAmount?: Decimal;
};

/**
 * Handles Paystack refunds and charge disputes as adverse funding exposure.
 *
 * A provider event never directly debits a wallet. The event is first stored
 * as a held case, then the original funding is looked up and independently
 * verified through Paystack. Operators can release a verified/favorably
 * resolved case or explicitly collect a bounded amount in a serializable
 * transaction. This keeps provider retries idempotent and avoids inventing a
 * full chargeback or creating a negative wallet balance.
 */
@Injectable()
export class PaystackAdverseFundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async processPaystackEvent(input: PaystackAdverseEventInput) {
    if (!this.isSupportedEvent(input.eventType)) {
      throw new BadRequestException('Unsupported Paystack adverse event');
    }
    const providerReference = input.providerReference?.trim();
    if (!providerReference || providerReference.length > 200) {
      throw new BadRequestException('Invalid Paystack adverse event reference');
    }

    const data = this.asRecord(input.data);
    const fundingReference = this.extractFundingReference(data);
    const providerStatus = this.extractProviderStatus(input.eventType, data);
    const payload = this.sanitizePayload(
      input.rawPayload ?? { event: input.eventType, data },
    );

    const existing = await this.prisma.fundingAdverseCase.findUnique({
      where: {
        provider_eventType_providerReference: {
          provider: 'PAYSTACK',
          eventType: input.eventType,
          providerReference,
        },
      },
    });

    // A completed inbox event can be delivered to a second worker after the
    // first worker committed. Never call the provider or collect twice.
    if (existing && existing.verificationStatus !== 'PENDING') {
      return this.resultForCase(existing);
    }

    const pendingCase = existing
      ? existing
      : await this.prisma.fundingAdverseCase.upsert({
          where: {
            provider_eventType_providerReference: {
              provider: 'PAYSTACK',
              eventType: input.eventType,
              providerReference,
            },
          },
          create: {
            provider: 'PAYSTACK',
            eventType: input.eventType,
            providerReference,
            fundingReference: fundingReference ?? undefined,
            status: 'OPEN',
            verificationStatus: 'PENDING',
            holdRequired: true,
            providerStatus,
            payload: payload as Prisma.InputJsonValue,
          },
          update: {
            fundingReference: fundingReference ?? undefined,
            providerStatus,
            payload: payload as Prisma.InputJsonValue,
            holdRequired: true,
          },
        });

    try {
      const verified = await this.verifyAgainstProvider(
        input.eventType,
        data,
        fundingReference,
      );

      const finalStatus =
        verified.resolution === 'declined'
          ? ('RESOLVED' as const)
          : ('OPEN' as const);
      const holdRequired = finalStatus !== 'RESOLVED';
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const saved = await tx.fundingAdverseCase.update({
            where: { id: pendingCase.id },
            data: {
              economicReference: verified.economicReference,
              fundingReference: verified.fundingReference,
              transactionId: verified.transaction.id,
              userId: verified.transaction.userId,
              currency: 'NGN',
              exposureAmount: verified.exposureAmount,
              providerStatus,
              verificationStatus: 'VERIFIED',
              status: finalStatus,
              holdRequired,
              resolution:
                finalStatus === 'RESOLVED'
                  ? 'PAYSTACK_DISPUTE_DECLINED'
                  : undefined,
              resolvedAt: finalStatus === 'RESOLVED' ? new Date() : undefined,
            },
          });

          // A decline is favorable provider evidence. Release only the
          // matching dispute identity, never unrelated disputes sharing one
          // original funding reference. Merchant-accepted disputes remain
          // held until a processed refund is independently observed.
          if (
            input.eventType.startsWith('charge.dispute.') &&
            verified.resolution === 'declined'
          ) {
            await tx.fundingAdverseCase.updateMany({
              where: {
                provider: 'PAYSTACK',
                economicReference: verified.economicReference,
                eventType: 'charge.dispute.create',
                status: { in: ['OPEN', 'UNDER_REVIEW'] },
                holdRequired: true,
              },
              data: {
                status: 'RESOLVED',
                holdRequired: false,
                verificationStatus: 'VERIFIED',
                resolution: 'PAYSTACK_DISPUTE_DECLINED',
                resolvedAt: new Date(),
              },
            });
          }

          await tx.auditLog.create({
            data: {
              action: 'PAYSTACK_ADVERSE_FUNDING_VERIFIED',
              targetType: 'FundingAdverseCase',
              targetId: saved.id,
              reference: verified.fundingReference,
              before: {
                status: pendingCase.status,
                verificationStatus: pendingCase.verificationStatus,
                holdRequired: pendingCase.holdRequired,
              },
              after: {
                status: saved.status,
                verificationStatus: saved.verificationStatus,
                holdRequired: saved.holdRequired,
                exposureAmount: verified.exposureAmount.toFixed(2),
              },
              metadata: {
                provider: 'PAYSTACK',
                eventType: input.eventType,
                providerReference,
                transactionId: verified.transaction.id,
              },
            },
          });

          return saved;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 5000,
          maxWait: 3000,
        },
      );

      return this.resultForCase(updated);
    } catch (error: unknown) {
      if (this.isTransientProviderError(error)) {
        const updated = await this.prisma.fundingAdverseCase.update({
          where: { id: pendingCase.id },
          data: {
            status: 'UNDER_REVIEW',
            verificationStatus: 'PENDING',
            holdRequired: true,
          },
        });
        this.logger?.warn(
          {
            caseId: pendingCase.id,
            eventType: input.eventType,
            providerReference,
          },
          'Paystack adverse funding verification is pending',
        );
        // Keep the inbox retryable while the durable case already blocks
        // outbound settlement.
        void updated;
        throw error;
      }

      const updated = await this.prisma.fundingAdverseCase.update({
        where: { id: pendingCase.id },
        data: {
          status: 'UNDER_REVIEW',
          verificationStatus: 'UNMATCHED',
          holdRequired: true,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          action: 'PAYSTACK_ADVERSE_FUNDING_REVIEW_REQUIRED',
          targetType: 'FundingAdverseCase',
          targetId: pendingCase.id,
          reference: fundingReference ?? providerReference,
          reason: this.safeErrorMessage(error),
          after: {
            status: 'UNDER_REVIEW',
            verificationStatus: 'UNMATCHED',
            holdRequired: true,
          },
          metadata: {
            provider: 'PAYSTACK',
            eventType: input.eventType,
            providerReference,
          },
        },
      });
      this.logger?.warn(
        {
          caseId: pendingCase.id,
          eventType: input.eventType,
          providerReference,
        },
        'Paystack adverse funding case requires review',
      );

      return {
        ...this.resultForCase(updated),
        reviewRequired: true,
      };
    }
  }

  listCases(status?: FundingAdverseCaseStatus) {
    return this.prisma.fundingAdverseCase.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'asc' },
      take: 100,
      // Do not expose the stored provider payload. It is redacted at ingest,
      // but the operator list should be safe even if a future provider field
      // slips past the redaction allowlist.
      select: {
        id: true,
        provider: true,
        eventType: true,
        providerReference: true,
        economicReference: true,
        fundingReference: true,
        transactionId: true,
        userId: true,
        currency: true,
        exposureAmount: true,
        recoveredAmount: true,
        status: true,
        verificationStatus: true,
        holdRequired: true,
        providerStatus: true,
        resolution: true,
        resolvedBy: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Re-runs provider correlation for a held case whose first verification
   * could not find a credited local funding row or was temporarily pending.
   * The provider event is read only from the sanitized payload persisted at
   * webhook ingest; an operator cannot replace it with arbitrary data.
   *
   * This path never calls the ledger. It also re-reads the case inside the
   * serializable update so a concurrent manual release or collection cannot
   * be reopened by a late provider response.
   */
  async recheckCase(
    caseId: string,
    adminId: string,
    input: PaystackAdverseRecheckInput,
  ) {
    const reason = input.reason?.trim();
    if (!reason || reason.length < 10 || reason.length > 500) {
      throw new BadRequestException(
        'A recheck reason between 10 and 500 characters is required',
      );
    }
    const operationKey = input.operationKey?.trim();
    if (!operationKey || operationKey.length > 256) {
      throw new BadRequestException(
        'A request idempotency key is required for provider recheck',
      );
    }

    const current = await this.prisma.fundingAdverseCase.findUnique({
      where: { id: caseId },
    });
    if (!current) throw new NotFoundException('Funding adverse case not found');
    if (!this.isRecheckableCase(current)) {
      throw new ConflictException(
        'Only held OPEN or UNDER_REVIEW PENDING/UNMATCHED cases can be rechecked',
      );
    }

    let verified: Awaited<
      ReturnType<PaystackAdverseFundingService['verifyAgainstProvider']>
    >;
    try {
      const storedEvent = this.storedEventForCase(current);
      verified = await this.verifyAgainstProvider(
        storedEvent.eventType,
        storedEvent.data,
        storedEvent.fundingReference,
      );
    } catch (error: unknown) {
      if (this.isTransientProviderError(error)) {
        await this.persistRecheckFailure(
          caseId,
          adminId,
          reason,
          operationKey,
          'PENDING',
          error,
        );
        throw error;
      }

      const updated = await this.persistRecheckFailure(
        caseId,
        adminId,
        reason,
        operationKey,
        'UNMATCHED',
        error,
      );
      return {
        ...this.resultForCase(updated),
        reviewRequired: true,
        rechecked: true,
      };
    }

    const finalStatus =
      verified.resolution === 'declined'
        ? ('RESOLVED' as const)
        : ('OPEN' as const);
    const holdRequired = finalStatus !== 'RESOLVED';
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.fundingAdverseCase.findUnique({
          where: { id: caseId },
        });
        if (!fresh) {
          throw new NotFoundException('Funding adverse case not found');
        }
        if (!this.isRecheckableCase(fresh)) {
          throw new ConflictException(
            'The funding case changed and is no longer eligible for recheck',
          );
        }

        const next = await tx.fundingAdverseCase.update({
          where: { id: caseId },
          data: {
            economicReference: verified.economicReference,
            fundingReference: verified.fundingReference,
            transactionId: verified.transaction.id,
            userId: verified.transaction.userId,
            currency: 'NGN',
            exposureAmount: verified.exposureAmount,
            verificationStatus: 'VERIFIED',
            status: finalStatus,
            holdRequired,
            resolution:
              finalStatus === 'RESOLVED' ? 'PAYSTACK_DISPUTE_DECLINED' : null,
            resolvedBy: finalStatus === 'RESOLVED' ? adminId : null,
            resolvedAt: finalStatus === 'RESOLVED' ? new Date() : null,
          },
        });

        await tx.auditLog.create({
          data: {
            adminId,
            action: 'PAYSTACK_ADVERSE_FUNDING_RECHECKED',
            targetType: 'FundingAdverseCase',
            targetId: caseId,
            reference: verified.fundingReference,
            reason,
            before: {
              status: fresh.status,
              verificationStatus: fresh.verificationStatus,
              holdRequired: fresh.holdRequired,
            },
            after: {
              status: next.status,
              verificationStatus: next.verificationStatus,
              holdRequired: next.holdRequired,
              exposureAmount: verified.exposureAmount.toFixed(2),
            },
            metadata: {
              provider: 'PAYSTACK',
              eventType: fresh.eventType,
              providerReference: fresh.providerReference,
              operationKeyDigest: this.operationKeyDigest(operationKey),
              recheckedFrom: fresh.verificationStatus,
            },
          },
        });

        return next;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5000,
        maxWait: 3000,
      },
    );

    return {
      ...this.resultForCase(updated),
      rechecked: true,
    };
  }

  async resolveCase(
    caseId: string,
    adminId: string,
    input: PaystackAdverseResolutionInput,
  ) {
    const reason = input.reason?.trim();
    if (!reason || reason.length < 10 || reason.length > 500) {
      throw new BadRequestException(
        'A resolution reason between 10 and 500 characters is required',
      );
    }

    if (input.action === 'RELEASE_HOLD' && input.amount !== undefined) {
      throw new BadRequestException(
        'A collection amount is not valid for a hold release',
      );
    }

    const current = await this.prisma.fundingAdverseCase.findUnique({
      where: { id: caseId },
    });
    if (!current) throw new NotFoundException('Funding adverse case not found');

    if (input.action === 'RELEASE_HOLD') {
      const resolved = await this.prisma.$transaction(
        async (tx) => {
          const fresh = await tx.fundingAdverseCase.findUnique({
            where: { id: caseId },
          });
          if (!fresh)
            throw new NotFoundException('Funding adverse case not found');
          if (!fresh.holdRequired || fresh.status === 'RESOLVED') {
            return fresh;
          }
          const next = await tx.fundingAdverseCase.update({
            where: { id: caseId },
            data: {
              status: 'RESOLVED',
              holdRequired: false,
              resolution: 'MANUAL_RELEASE',
              resolvedBy: adminId,
              resolvedAt: new Date(),
            },
          });
          await tx.auditLog.create({
            data: {
              adminId,
              action: 'PAYSTACK_ADVERSE_FUNDING_HOLD_RELEASED',
              targetType: 'FundingAdverseCase',
              targetId: caseId,
              reference: next.fundingReference ?? next.providerReference,
              reason,
              before: {
                status: fresh.status,
                holdRequired: fresh.holdRequired,
              },
              after: { status: next.status, holdRequired: next.holdRequired },
              metadata: {
                provider: next.provider,
                eventType: next.eventType,
                providerReference: next.providerReference,
              },
            },
          });
          return next;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 5000,
          maxWait: 3000,
        },
      );
      return {
        caseId,
        status: resolved.status,
        holdRequired: resolved.holdRequired,
        recoveredAmount: new Decimal(resolved.recoveredAmount).toFixed(2),
      };
    }

    if (input.action !== 'COLLECT') {
      throw new BadRequestException(
        'Unsupported adverse-case resolution action',
      );
    }
    if (!input.amount) {
      throw new BadRequestException(
        'An explicit collection amount is required; full dispute debits are never implicit',
      );
    }
    const operationKey = input.operationKey?.trim();
    if (!operationKey || operationKey.length > 256) {
      throw new BadRequestException(
        'A request idempotency key is required for collection',
      );
    }
    const amount = this.parseDecimalAmount(input.amount);
    if (!amount) throw new BadRequestException('Invalid collection amount');
    const operationKeyDigest = this.operationKeyDigest(operationKey);
    const recoveryReference = this.recoveryReference(caseId, operationKey);
    const collected = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.fundingAdverseCase.findUnique({
          where: { id: caseId },
        });
        if (!fresh)
          throw new NotFoundException('Funding adverse case not found');

        // Resolve the durable business operation before looking at the
        // current hold state. A retry after the first collection fully
        // resolves the case must return the original receipt, while the same
        // key with a changed amount/case payload must fail closed.
        const existingRecovery = await tx.transaction.findUnique({
          where: { reference: recoveryReference },
        });
        if (existingRecovery) {
          const metadata = this.record(existingRecovery.metadata);
          const sameOperation =
            metadata.flow === 'ADVERSE_FUNDING_RECOVERY' &&
            metadata.action === 'COLLECT' &&
            metadata.caseId === caseId &&
            metadata.operationKeyDigest === operationKeyDigest &&
            metadata.caseFingerprint === this.caseFingerprint(fresh) &&
            metadata.amount === amount.toFixed(2);
          if (!sameOperation) {
            throw new ConflictException(
              'Collection idempotency key was already used with different details',
            );
          }
          return {
            case: fresh,
            transaction: existingRecovery,
            idempotent: true,
          };
        }
        if (!fresh.holdRequired || fresh.status === 'RESOLVED') {
          return {
            case: fresh,
            transaction: null,
            idempotent: true,
          };
        }

        // A dispute is evidence of exposure, not proof that Paystack has
        // actually removed money. Only an independently verified processed
        // refund may be collected; charge.dispute.create and
        // merchant-accepted resolution stay held until that refund event.
        if (
          fresh.eventType !== 'refund.processed' ||
          fresh.providerStatus?.toLowerCase() !== 'processed' ||
          fresh.verificationStatus !== 'VERIFIED' ||
          !fresh.economicReference?.startsWith('refund:') ||
          !fresh.fundingReference ||
          !fresh.transactionId ||
          !fresh.userId ||
          !fresh.currency ||
          !fresh.exposureAmount
        ) {
          throw new ConflictException(
            'Only an independently verified processed refund can be collected',
          );
        }

        const refundCases = await tx.fundingAdverseCase.findMany({
          where: {
            provider: 'PAYSTACK',
            fundingReference: fresh.fundingReference,
            transactionId: fresh.transactionId,
            eventType: 'refund.processed',
            verificationStatus: 'VERIFIED',
            economicReference: { not: null },
          },
          select: {
            id: true,
            economicReference: true,
            exposureAmount: true,
            recoveredAmount: true,
          },
        });
        const originalFunding = await tx.transaction.findUnique({
          where: { id: fresh.transactionId },
          select: { amount: true, type: true, status: true, currency: true },
        });
        if (
          !originalFunding ||
          originalFunding.type !== 'FUND' ||
          originalFunding.status !== 'SUCCESS' ||
          originalFunding.currency !== fresh.currency
        ) {
          throw new ConflictException(
            'The original funding transaction could not be revalidated',
          );
        }

        // Deduplicate repeated webhook deliveries by economic identity while
        // still summing recovered amounts from every event row. This caps two
        // overlapping refund cases at the greater verified amount for that
        // refund and caps all refunds at the original funding amount.
        const economicGroups = new Map<
          string,
          { exposure: Decimal; recovered: Decimal }
        >();
        for (const refundCase of refundCases) {
          if (!refundCase.economicReference || !refundCase.exposureAmount)
            continue;
          const key = refundCase.economicReference;
          const existingGroup = economicGroups.get(key);
          const exposure = new Decimal(refundCase.exposureAmount);
          const recovered = new Decimal(refundCase.recoveredAmount);
          if (existingGroup) {
            if (exposure.greaterThan(existingGroup.exposure)) {
              existingGroup.exposure = exposure;
            }
            existingGroup.recovered = existingGroup.recovered.plus(recovered);
          } else {
            economicGroups.set(key, { exposure, recovered });
          }
        }
        const currentGroup = economicGroups.get(fresh.economicReference);
        if (!currentGroup) {
          throw new ConflictException(
            'The processed refund exposure could not be revalidated',
          );
        }
        const totalRecovered = [...economicGroups.values()].reduce(
          (total, group) => total.plus(group.recovered),
          new Decimal(0),
        );
        const totalVerifiedExposure = [...economicGroups.values()].reduce(
          (total, group) => total.plus(group.exposure),
          new Decimal(0),
        );
        const currentRemaining = new Decimal(fresh.exposureAmount).minus(
          fresh.recoveredAmount,
        );
        const groupRemaining = currentGroup.exposure.minus(
          currentGroup.recovered,
        );
        const aggregateRemaining = new Decimal(originalFunding.amount).minus(
          totalRecovered,
        );
        const verifiedExposureRemaining =
          totalVerifiedExposure.minus(totalRecovered);
        const remaining = [
          currentRemaining,
          groupRemaining,
          aggregateRemaining,
          verifiedExposureRemaining,
        ].reduce((smallest, candidate) =>
          candidate.lessThan(smallest) ? candidate : smallest,
        );
        if (amount.greaterThan(remaining) || remaining.lessThanOrEqualTo(0)) {
          throw new BadRequestException(
            'Collection amount exceeds the unresolved verified refund exposure',
          );
        }

        // Temporarily clear this case's hold inside the same transaction. Any
        // competing outbound transaction sees the old committed hold and is
        // rejected; a failed debit rolls the temporary change back.
        await tx.fundingAdverseCase.update({
          where: { id: caseId },
          data: { holdRequired: false },
        });

        const recoveryTransaction = await tx.transaction.create({
          data: {
            userId: fresh.userId,
            type: 'FUNDING_RECOVERY',
            amount,
            currency: fresh.currency,
            status: 'SUCCESS',
            reference: recoveryReference,
            metadata: {
              provider: 'PAYSTACK',
              flow: 'ADVERSE_FUNDING_RECOVERY',
              caseId,
              sourceProviderReference: fresh.providerReference,
              fundingReference: fresh.fundingReference,
              operationKeyDigest,
              action: 'COLLECT',
              caseFingerprint: this.caseFingerprint(fresh),
              amount: amount.toFixed(2),
            },
          },
        });

        const movement = await this.ledger.debitWalletForAdverseFunding(
          {
            userId: fresh.userId,
            currency: fresh.currency,
            amount,
            transactionId: recoveryTransaction.id,
            reference: recoveryReference,
            source: 'PAYSTACK_ADVERSE_RECOVERY',
            metadata: {
              caseId,
              providerReference: fresh.providerReference,
              operationKeyDigest,
              action: 'COLLECT',
              caseFingerprint: this.caseFingerprint(fresh),
              amount: amount.toFixed(2),
            },
          },
          tx,
        );

        await tx.transaction.update({
          where: { id: recoveryTransaction.id },
          data: { walletId: movement.walletId },
        });

        const nextRecovered = new Decimal(fresh.recoveredAmount).plus(amount);
        const fullyRecovered = nextRecovered.greaterThanOrEqualTo(
          new Decimal(fresh.exposureAmount ?? 0),
        );
        const next = await tx.fundingAdverseCase.update({
          where: { id: caseId },
          data: {
            recoveredAmount: nextRecovered,
            status: fullyRecovered ? 'RESOLVED' : 'UNDER_REVIEW',
            holdRequired: !fullyRecovered,
            resolution: fullyRecovered
              ? 'MANUAL_COLLECTION'
              : 'PARTIAL_MANUAL_COLLECTION',
            resolvedBy: fullyRecovered ? adminId : undefined,
            resolvedAt: fullyRecovered ? new Date() : undefined,
          },
        });
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'PAYSTACK_ADVERSE_FUNDING_COLLECTED',
            targetType: 'FundingAdverseCase',
            targetId: caseId,
            reference: recoveryReference,
            reason,
            before: {
              status: fresh.status,
              holdRequired: fresh.holdRequired,
              recoveredAmount: new Decimal(fresh.recoveredAmount).toFixed(2),
              walletBalance: movement.balanceBefore.toFixed(2),
            },
            after: {
              status: next.status,
              holdRequired: next.holdRequired,
              recoveredAmount: nextRecovered.toFixed(2),
              walletBalance: movement.balanceAfter.toFixed(2),
            },
            metadata: {
              provider: fresh.provider,
              eventType: fresh.eventType,
              providerReference: fresh.providerReference,
              amount: amount.toFixed(2),
            },
          },
        });

        return {
          case: next,
          transaction: recoveryTransaction,
          idempotent: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5000,
        maxWait: 3000,
      },
    );

    return {
      caseId,
      status: collected.case.status,
      holdRequired: collected.case.holdRequired,
      recoveredAmount: new Decimal(collected.case.recoveredAmount).toFixed(2),
      reference: collected.transaction?.reference ?? recoveryReference,
      idempotent: collected.idempotent,
    };
  }

  private async verifyAgainstProvider(
    eventType: PaystackAdverseEventType,
    data: Record<string, unknown>,
    fundingReference: string | null,
  ) {
    if (!fundingReference) {
      throw new PermanentAdverseReviewError(
        'Paystack adverse event did not include an original funding reference',
      );
    }

    const local = (await this.prisma.transaction.findUnique({
      where: { reference: fundingReference },
    })) as LocalFundingTransaction | null;
    if (!local) {
      throw new PermanentAdverseReviewError(
        'Paystack adverse event does not match a local funding transaction',
      );
    }
    // An adverse recovery is only valid against a still-credited funding
    // transaction. A local REVERSED row may already have been compensated;
    // accepting it here would turn a provider notification into a second
    // recovery against the same economic loss.
    if (
      local.type !== 'FUND' ||
      local.status !== 'SUCCESS' ||
      local.currency !== 'NGN'
    ) {
      throw new PermanentAdverseReviewError(
        'Paystack adverse event does not match a credited NGN funding transaction',
      );
    }

    const payment = await this.paystack.request<ProviderTransaction>(
      'GET',
      `/transaction/verify/${encodeURIComponent(fundingReference)}`,
    );
    const expectedDomain = this.config
      .get<string>('PAYSTACK_SECRET_KEY')
      ?.startsWith('sk_live_')
      ? 'live'
      : 'test';
    if (
      payment.reference !== fundingReference ||
      payment.domain !== expectedDomain ||
      payment.currency !== 'NGN' ||
      String(payment.status).toLowerCase() !== 'success'
    ) {
      throw new PermanentAdverseReviewError(
        'Paystack independently verified payment does not match the funding reference',
      );
    }

    const verifiedAmount = this.parseMinorAmount(payment.amount);
    if (!verifiedAmount || !verifiedAmount.eq(new Decimal(local.amount))) {
      throw new PermanentAdverseReviewError(
        'Paystack independently verified amount does not match the funding transaction',
      );
    }

    const localMetadata = this.record(local.metadata);
    const customerCode = payment.customer?.customer_code;
    let customerMatches =
      typeof customerCode === 'string' &&
      customerCode.trim().length > 0 &&
      localMetadata.provider === 'PAYSTACK' &&
      typeof localMetadata.customerCode === 'string' &&
      localMetadata.customerCode === customerCode;
    if (!customerMatches && localMetadata.provider === 'PAYSTACK') {
      // DVA/legacy FUND rows may predate checkout metadata. Re-bind them to
      // the user's Paystack identity (or to the owned Paystack virtual
      // account) before accepting any provider-side adverse event.
      const customerBinding = await this.prisma.paystackCustomer.findUnique({
        where: { userId: local.userId },
        select: { customerCode: true },
      });
      customerMatches =
        typeof customerCode === 'string' &&
        customerCode.trim().length > 0 &&
        customerBinding?.customerCode === customerCode;
      if (!customerMatches) {
        const virtualAccountId = this.getString(
          localMetadata,
          'virtualAccountId',
        );
        if (virtualAccountId) {
          const virtualAccount = await this.prisma.virtualAccount.findUnique({
            where: { id: virtualAccountId },
            select: {
              userId: true,
              provider: true,
              providerCustomerId: true,
              currency: true,
            },
          });
          customerMatches =
            virtualAccount?.userId === local.userId &&
            virtualAccount.provider === 'PAYSTACK' &&
            virtualAccount.currency === 'NGN' &&
            typeof customerCode === 'string' &&
            customerCode.trim().length > 0 &&
            virtualAccount.providerCustomerId === customerCode;
        }
      }
    }
    if (!customerMatches) {
      throw new PermanentAdverseReviewError(
        'Paystack customer does not match the funding owner',
      );
    }

    let providerResolution: string | undefined;
    let exposureAmount: Decimal;
    let economicReference: string;
    if (eventType.startsWith('charge.dispute.')) {
      const disputeReference = this.getIdentifier(data, 'id');
      if (!disputeReference) {
        throw new PermanentAdverseReviewError(
          'Paystack dispute event did not include a provider dispute id',
        );
      }
      const dispute = await this.paystack.request<ProviderDispute>(
        'GET',
        `/dispute/${encodeURIComponent(disputeReference)}`,
      );
      const disputeTransaction = dispute.transaction;
      const disputeCurrency = dispute.currency ?? disputeTransaction?.currency;
      const disputeDomain = dispute.domain ?? disputeTransaction?.domain;
      if (
        disputeTransaction?.reference !== fundingReference ||
        disputeCurrency !== 'NGN' ||
        disputeDomain !== expectedDomain
      ) {
        throw new PermanentAdverseReviewError(
          'Paystack dispute record does not match the funding reference',
        );
      }
      providerResolution = dispute.resolution?.trim().toLowerCase();
      if (
        providerResolution &&
        !['declined', 'merchant-accepted'].includes(providerResolution)
      ) {
        throw new PermanentAdverseReviewError(
          'Paystack dispute resolution is unsupported',
        );
      }
      if (eventType === 'charge.dispute.resolve') {
        const eventResolution = this.getString(
          data,
          'resolution',
        )?.toLowerCase();
        if (
          !eventResolution ||
          !['declined', 'merchant-accepted'].includes(eventResolution)
        ) {
          throw new PermanentAdverseReviewError(
            'Paystack dispute resolution is missing or unsupported',
          );
        }
        if (
          String(dispute.status).toLowerCase() !== 'resolved' ||
          providerResolution !== eventResolution
        ) {
          throw new PermanentAdverseReviewError(
            'Paystack dispute resolution does not match the provider record',
          );
        }
        providerResolution = eventResolution;
      }
      const disputeAmount = this.parseMinorAmount(disputeTransaction.amount);
      if (
        !disputeAmount ||
        disputeAmount.greaterThan(new Decimal(local.amount))
      ) {
        throw new PermanentAdverseReviewError(
          'Paystack dispute amount is missing or exceeds the original funding amount',
        );
      }
      exposureAmount = disputeAmount;
      economicReference = `dispute:${disputeReference}`;
    } else {
      const refundReference =
        this.getString(data, 'refund_reference') ??
        this.getIdentifier(data, 'id');
      let refund: ProviderRefund;
      if (refundReference) {
        refund = await this.paystack.request<ProviderRefund>(
          'GET',
          `/refund/${encodeURIComponent(refundReference)}`,
        );
      } else {
        // Paystack's documented webhook example may omit refund_reference.
        // List refunds by the independently verified provider transaction ID;
        // the signed webhook amount/reference is never the authority.
        if (payment.id === undefined || payment.id === null) {
          throw new PermanentAdverseReviewError(
            'Paystack refund could not be independently correlated to a provider transaction',
          );
        }
        const refunds = await this.paystack.page<ProviderRefund>('/refund', {
          transaction: String(payment.id),
          currency: 'NGN',
          perPage: '100',
        });
        const processed = refunds.data.filter(
          (candidate) =>
            String(candidate.status).toLowerCase() === 'processed' &&
            candidate.currency === 'NGN' &&
            candidate.domain === expectedDomain &&
            this.refundMatchesTransaction(candidate, payment, fundingReference),
        );
        if (processed.length !== 1) {
          throw new PermanentAdverseReviewError(
            'Paystack processed refund could not be independently matched to one amount',
          );
        }
        refund = processed[0];
      }

      if (
        String(refund.status).toLowerCase() !== 'processed' ||
        refund.currency !== 'NGN' ||
        refund.domain !== expectedDomain ||
        !this.refundMatchesTransaction(refund, payment, fundingReference)
      ) {
        throw new PermanentAdverseReviewError(
          'Paystack refund is not independently confirmed as processed for this funding transaction',
        );
      }
      const refundId = this.getIdentifier(this.asRecord(refund), 'id');
      if (!refundId) {
        throw new PermanentAdverseReviewError(
          'Paystack processed refund did not include an authoritative refund id',
        );
      }
      const refundAmount = this.parseMinorAmount(refund.amount);
      if (!refundAmount) {
        throw new PermanentAdverseReviewError(
          'Paystack processed refund did not include an authoritative amount',
        );
      }
      exposureAmount = refundAmount;
      economicReference = `refund:${refundId}`;
    }

    if (
      exposureAmount.lessThanOrEqualTo(0) ||
      exposureAmount.greaterThan(new Decimal(local.amount))
    ) {
      throw new PermanentAdverseReviewError(
        'Paystack adverse exposure exceeds the original funding amount',
      );
    }

    const resolution = providerResolution;
    return {
      transaction: local,
      fundingReference,
      exposureAmount,
      resolution,
      economicReference,
    };
  }

  private refundMatchesTransaction(
    refund: ProviderRefund,
    payment: ProviderTransaction,
    fundingReference: string,
  ) {
    if (refund.transaction_reference === fundingReference) return true;
    const providerTransaction = refund.transaction;
    if (
      providerTransaction &&
      typeof providerTransaction === 'object' &&
      providerTransaction.reference === fundingReference
    ) {
      return true;
    }
    if (payment.id === undefined || payment.id === null) return false;
    if (typeof providerTransaction === 'object' && providerTransaction) {
      return (
        providerTransaction.id !== undefined &&
        String(providerTransaction.id) === String(payment.id)
      );
    }
    return (
      providerTransaction !== undefined &&
      String(providerTransaction) === String(payment.id)
    );
  }

  private isRecheckableCase(caseRecord: {
    status: FundingAdverseCaseStatus;
    verificationStatus: FundingAdverseVerificationStatus;
    holdRequired: boolean;
  }) {
    return (
      caseRecord.holdRequired &&
      (caseRecord.status === 'OPEN' || caseRecord.status === 'UNDER_REVIEW') &&
      (caseRecord.verificationStatus === 'PENDING' ||
        caseRecord.verificationStatus === 'UNMATCHED')
    );
  }

  private storedEventForCase(caseRecord: {
    eventType: string;
    fundingReference: string | null;
    payload: Prisma.JsonValue | null;
  }) {
    if (!this.isSupportedEvent(caseRecord.eventType)) {
      throw new PermanentAdverseReviewError(
        'Stored Paystack adverse event type is unsupported',
      );
    }
    const payload = this.record(caseRecord.payload);
    const storedEvent = this.getString(payload, 'event');
    if (storedEvent && storedEvent !== caseRecord.eventType) {
      throw new PermanentAdverseReviewError(
        'Stored Paystack adverse event type does not match its case',
      );
    }
    const data = this.asRecord(payload.data);
    const fundingReference = this.extractFundingReference(data);
    if (
      !fundingReference ||
      (caseRecord.fundingReference &&
        fundingReference !== caseRecord.fundingReference)
    ) {
      throw new PermanentAdverseReviewError(
        'Stored Paystack adverse event does not contain the original funding reference',
      );
    }
    return {
      eventType: caseRecord.eventType,
      data,
      fundingReference,
    };
  }

  private async persistRecheckFailure(
    caseId: string,
    adminId: string,
    reason: string,
    operationKey: string,
    verificationStatus: 'PENDING' | 'UNMATCHED',
    error: unknown,
  ) {
    const providerReason = this.safeErrorMessage(error);
    return this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.fundingAdverseCase.findUnique({
          where: { id: caseId },
        });
        if (!fresh) {
          throw new NotFoundException('Funding adverse case not found');
        }
        if (!this.isRecheckableCase(fresh)) {
          throw new ConflictException(
            'The funding case changed and is no longer eligible for recheck',
          );
        }

        const next = await tx.fundingAdverseCase.update({
          where: { id: caseId },
          data: {
            status: 'UNDER_REVIEW',
            verificationStatus,
            holdRequired: true,
          },
        });
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'PAYSTACK_ADVERSE_FUNDING_RECHECK_REQUIRED',
            targetType: 'FundingAdverseCase',
            targetId: caseId,
            reference: next.fundingReference ?? next.providerReference,
            reason,
            before: {
              status: fresh.status,
              verificationStatus: fresh.verificationStatus,
              holdRequired: fresh.holdRequired,
            },
            after: {
              status: next.status,
              verificationStatus: next.verificationStatus,
              holdRequired: next.holdRequired,
            },
            metadata: {
              provider: 'PAYSTACK',
              eventType: next.eventType,
              providerReference: next.providerReference,
              operationKeyDigest: this.operationKeyDigest(operationKey),
              providerReason,
            },
          },
        });
        return next;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5000,
        maxWait: 3000,
      },
    );
  }

  private resultForCase(caseRecord: AdverseCaseLike) {
    return {
      routed: 'adverse-funding' as const,
      caseId: caseRecord.id,
      status: caseRecord.status,
      holdRequired: caseRecord.holdRequired,
      reviewRequired:
        caseRecord.status === 'UNDER_REVIEW' || caseRecord.holdRequired,
      exposureAmount: caseRecord.exposureAmount
        ? new Decimal(caseRecord.exposureAmount).toFixed(2)
        : undefined,
    };
  }

  private isSupportedEvent(value: string): value is PaystackAdverseEventType {
    return (PAYSTACK_ADVERSE_EVENT_TYPES as readonly string[]).includes(value);
  }

  private extractFundingReference(data: Record<string, unknown>) {
    const direct =
      this.getString(data, 'transaction_reference') ??
      this.getString(data, 'reference');
    if (direct) return direct;
    const transaction = this.asRecord(data.transaction);
    return this.getString(transaction, 'reference');
  }

  private extractProviderStatus(
    eventType: PaystackAdverseEventType,
    data: Record<string, unknown>,
  ) {
    return (
      this.getString(data, 'status') ??
      this.getString(data, 'resolution') ??
      eventType
    ).slice(0, 100);
  }

  private parseMinorAmount(value: unknown): Decimal | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    try {
      const minor = new Decimal(value);
      if (!minor.isFinite() || !minor.isInteger() || minor.lessThanOrEqualTo(0))
        return null;
      return minor.div(100);
    } catch {
      return null;
    }
  }

  private parseDecimalAmount(value: string) {
    try {
      const amount = new Decimal(value.trim());
      if (
        !amount.isFinite() ||
        amount.lessThanOrEqualTo(0) ||
        amount.decimalPlaces() > 2 ||
        amount.greaterThan(new Decimal('9999999999999.99'))
      )
        return null;
      return amount;
    } catch {
      return null;
    }
  }

  private recoveryReference(caseId: string, operationKey: string) {
    const digest = createHash('sha256')
      .update(`${caseId}:${this.operationKeyDigest(operationKey)}`)
      .digest('hex')
      .slice(0, 32);
    return `fund-adverse-${digest}`;
  }

  private operationKeyDigest(operationKey: string) {
    return createHash('sha256').update(operationKey).digest('hex');
  }

  private caseFingerprint(caseRecord: {
    provider: string;
    eventType: string;
    providerReference: string;
    economicReference?: string | null;
    fundingReference?: string | null;
  }) {
    return createHash('sha256')
      .update(
        [
          caseRecord.provider,
          caseRecord.eventType,
          caseRecord.providerReference,
          caseRecord.economicReference ?? '',
          caseRecord.fundingReference ?? '',
        ].join(':'),
      )
      .digest('hex');
  }

  private isTransientProviderError(error: unknown) {
    return (
      error instanceof ServiceUnavailableException ||
      (!(error instanceof BadRequestException) &&
        !(error instanceof PermanentAdverseReviewError) &&
        !(error instanceof ConflictException) &&
        !(error instanceof NotFoundException))
    );
  }

  private safeErrorMessage(error: unknown) {
    if (error instanceof PermanentAdverseReviewError) return error.message;
    if (error instanceof Error) return error.message.slice(0, 500);
    return 'Paystack adverse event requires manual review';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private record(value: Prisma.JsonValue | null) {
    return this.asRecord(value);
  }

  private getString(record: Record<string, unknown>, key: string) {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private getIdentifier(record: Record<string, unknown>, key: string) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return String(value);
    }
    return null;
  }

  private sanitizePayload(value: unknown): unknown {
    if (Array.isArray(value))
      return value.map((entry) => this.sanitizePayload(entry));
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        [
          'authorizationCode',
          'authorization_code',
          'token',
          'signature',
          'bvn',
          'nin',
          'accountNumberEncrypted',
        ].includes(key)
      ) {
        continue;
      }
      output[key] = this.sanitizePayload(entry);
    }
    return output;
  }
}

class PermanentAdverseReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentAdverseReviewError';
  }
}
