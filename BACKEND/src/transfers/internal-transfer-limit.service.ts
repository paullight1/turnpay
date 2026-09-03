import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KYCTier, WalletCurrency } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

export type ActiveInternalTransferLimitPolicy = {
  id: string;
  currency: WalletCurrency;
  kycTier: KYCTier;
  perTransaction: Decimal;
  daily: Decimal;
  monthly: Decimal;
  enabled: boolean;
  version: number;
};

type LimitPolicyClient = {
  internalTransferLimitPolicy: {
    findFirst(args: {
      where: {
        currency: WalletCurrency;
        kycTier: KYCTier;
        enabled: boolean;
        effectiveFrom: { lte: Date };
      };
      orderBy: { version: 'desc' };
    }): Promise<ActiveInternalTransferLimitPolicy | null>;
  };
};

@Injectable()
export class InternalTransferLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async getActivePolicy(
    client: LimitPolicyClient | undefined,
    currency: WalletCurrency,
    kycTier: KYCTier,
  ) {
    const database = client ?? this.prisma;
    const policy = await database.internalTransferLimitPolicy.findFirst({
      where: {
        currency,
        kycTier,
        enabled: true,
        effectiveFrom: { lte: new Date() },
      },
      orderBy: { version: 'desc' },
    });

    if (!policy) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'TRANSFER_POLICY_UNAVAILABLE',
        message: `Internal transfers are unavailable for ${currency} ${kycTier}`,
      });
    }

    return policy;
  }

  assertAmountWithinPolicy(
    amount: Decimal,
    policy: Pick<ActiveInternalTransferLimitPolicy, 'perTransaction'>,
  ) {
    if (amount.greaterThan(policy.perTransaction)) {
      throw new BadRequestException(
        `Internal transfer limit exceeded. Maximum per transfer: ${policy.perTransaction.toFixed(2)}`,
      );
    }
  }
}
