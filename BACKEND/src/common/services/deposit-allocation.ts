import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/** One bank reference can back one obligation, including webhook/admin-replay funding. */
export async function allocateDepositReference(
  tx: Prisma.TransactionClient,
  input: {
    reference: string;
    settlementId: string;
    amount: Decimal;
    kind: 'EXCHANGE' | 'FUNDING';
    legacyReceiptId?: string;
    existingFundingTransactionId?: string;
    verifiedExchangeProviderEventId?: string;
  },
) {
  const reference = input.reference.trim().toUpperCase();
  const matches = { equals: reference, mode: 'insensitive' as const };
  const funding = await tx.transaction.findFirst({
    where: {
      type: 'FUND',
      reference: matches,
      ...(input.existingFundingTransactionId
        ? { id: { not: input.existingFundingTransactionId } }
        : {}),
    },
    select: { id: true },
  });
  const receipt = await tx.exchangeReceipt.findFirst({
    where: {
      bankReference: matches,
      ...(input.legacyReceiptId ? { id: { not: input.legacyReceiptId } } : {}),
      // Pending screenshots do not prevent a genuine provider deposit. Approved legacy credits do.
      ...(input.kind === 'FUNDING'
        ? { status: { in: ['APPROVED', 'CREDITED'] } }
        : {}),
    },
    select: { id: true },
  });
  const provider =
    input.kind === 'EXCHANGE'
      ? await tx.providerEvent.findFirst({
          where: {
            providerReference: matches,
            ...(input.verifiedExchangeProviderEventId
              ? { id: { not: input.verifiedExchangeProviderEventId } }
              : {}),
          },
          select: { id: true },
        })
      : null;
  const inbox =
    input.kind === 'EXCHANGE' && !input.verifiedExchangeProviderEventId
      ? await tx.paymentWebhookInbox.findFirst({
          where: { providerReference: matches },
          select: { id: true },
        })
      : null;
  if (funding || receipt || provider || inbox)
    throw new ConflictException(
      'This deposit already has a funding or exchange record; reconcile before allocating',
    );
  try {
    await tx.exchangeDepositAllocation.create({
      data: {
        reference,
        settlementId: input.settlementId,
        amount: input.amount,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new ConflictException('This deposit has already been allocated');
    throw error;
  }
  return reference;
}
