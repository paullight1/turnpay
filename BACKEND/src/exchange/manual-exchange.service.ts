import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualExchangeOrder, Prisma } from '@prisma/client';
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
  ManualProofUploadDto,
  ReviewManualExchangeDto,
} from './dto/manual-exchange.dto';
import {
  ManualStatus,
  nextManualExchangeStatus,
  quoteManualExchange,
} from './manual-exchange.policy';

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

@Injectable()
export class ManualExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly rateService: RateService,
    private readonly ledger: LedgerService,
    private readonly pin: TransactionPinService,
    private readonly storage: SupabaseService,
    private readonly logger: PinoLogger,
  ) {}

  configuration() {
    return {
      enabled: this.enabled(),
      sourceCurrency: 'NGN',
      targetCurrency: 'GHS',
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
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { isSuspended: true, kycStatus: true, kycTier: true },
    });
    if (!user) throw new NotFoundException('Account not found');
    if (user.isSuspended) throw new ForbiddenException('Account is suspended');
    if (
      user.kycStatus !== 'VERIFIED' ||
      !isKycTierAtLeast(user.kycTier, 'TIER_2')
    )
      throw new ForbiddenException('KYC Tier 2 is required for exchange');
  }
  private collection() {
    const values = {
      bankName: this.config.get<string>(
        'MANUAL_EXCHANGE_COLLECTION_BANK_NAME',
        '',
      ),
      accountName: this.config.get<string>(
        'MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NAME',
        '',
      ),
      accountNumber: this.config.get<string>(
        'MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NUMBER',
        '',
      ),
      version: this.config.get<string>(
        'MANUAL_EXCHANGE_COLLECTION_VERSION',
        '',
      ),
      currency: 'NGN',
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
    this.requireEnabled();
    await this.eligible(userId);
    if (
      dto.settlementMode === 'WALLET' &&
      !(await this.prisma.wallet.findUnique({
        where: { userId_currency: { userId, currency: 'GHS' } },
        select: { id: true },
      }))
    )
      throw new ConflictException(
        'Set up your GHS wallet before creating a wallet exchange',
      );
    await this.pin.verifyRequired(userId, dto.transactionPin);
    const keyHash = this.key(key);
    const business = {
      amount: dto.amount,
      settlementMode: dto.settlementMode,
      destinationInstitution: dto.destinationInstitution,
      destinationAccount: dto.destinationAccount,
      destinationName: dto.destinationName,
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
    if (
      dto.settlementMode === 'WALLET' &&
      (dto.destinationAccount ||
        dto.destinationInstitution ||
        dto.destinationName)
    )
      throw new BadRequestException(
        'Wallet settlement cannot include external account details',
      );
    const collection = this.collection();
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
    const live = await this.rateService.getRate('NGN', 'GHS');
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
          const transaction = await tx.transaction.create({
            data: {
              userId,
              type: 'EXCHANGE',
              currency: 'NGN',
              amount: quote.amount,
              fee: quote.fee,
              reference,
              metadata: {
                flow: 'MANUAL_EXCHANGE',
                ...auditContext,
                settlementMode: dto.settlementMode,
                targetCurrency: 'GHS',
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
              ...quote,
              collectionAccount: collection,
              destinationInstitution: dto.destinationInstitution?.trim(),
              destinationAccount: dto.destinationAccount?.trim(),
              destinationName: dto.destinationName?.trim(),
              expiresAt: new Date(Date.now() + 30 * 60 * 1000),
              events: {
                create: {
                  actorId: userId,
                  action: 'CREATE',
                  keyHash,
                  requestHash: fingerprint,
                  status: 'AWAITING_TRANSFER',
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
  ) {
    const row = await this.find(id, admin ? undefined : actorId);
    if (
      admin
        ? row.status !== 'PAYOUT_PROCESSING' || row.payoutClaimedBy !== actorId
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
      return this.present(await this.find(id, userId, tx));
    });
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
    if (dto.action === 'MARK_SENT') {
      if (!dto.payoutProofObjectKey)
        throw new BadRequestException('Payout evidence is required');
      await this.verifyProof(id, adminId, dto.payoutProofObjectKey, 'PAYOUT');
    }
    return this.mutate(async (tx) => {
      const row = await this.find(id, undefined, tx);
      if (await this.replay(tx, id, adminId, dto.action, keyHash, fingerprint))
        return this.present(row, true);
      const next = nextManualExchangeStatus(
        row.status,
        row.settlementMode,
        dto.action,
      );
      const update: Prisma.ManualExchangeOrderUpdateManyMutationInput = {
        status: next,
        reviewReason: dto.reason,
      };
      if (dto.action === 'CREDIT_WALLET' || dto.action === 'CONFIRM_DEPOSIT') {
        this.requireEnabled();
        await this.eligible(row.userId, tx);
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
      if (dto.action === 'CLAIM_PAYOUT') update.payoutClaimedBy = adminId;
      if (dto.action === 'MARK_SENT') {
        if (row.payoutClaimedBy !== adminId)
          throw new ForbiddenException(
            'Only the assigned payout operator can record this payment',
          );
        if (!dto.payoutReference)
          throw new BadRequestException('Actual payout reference is required');
        update.payoutReference = dto.payoutReference.trim().toUpperCase();
        update.payoutProofKey = dto.payoutProofObjectKey;
      }
      await this.claimVersion(tx, row, update);
      if (next === 'CREDITED') {
        await this.ledger.creditWallet(
          {
            userId: row.userId,
            currency: 'GHS',
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
        dto.reason,
      );
      await tx.auditLog.create({
        data: {
          adminId,
          action: `MANUAL_EXCHANGE_${dto.action}`,
          targetType: 'ManualExchangeOrder',
          targetId: id,
          reference: row.reference,
          reason: dto.reason,
          before: { status: row.status },
          after: { status: next, settlementMode: row.settlementMode },
          metadata: {
            ...auditContext,
            amount: row.amount.toFixed(2),
            targetAmount: row.targetAmount.toFixed(2),
            ...(dto.acceptExpiredQuote === true
              ? {
                  acceptedExpiredQuote: true,
                  originalExpiresAt: row.expiresAt.toISOString(),
                }
              : {}),
          },
        },
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
