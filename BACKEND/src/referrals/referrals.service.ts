import { BadRequestException, Injectable } from '@nestjs/common';
import { ReferralStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const REFERRAL_REWARD_NGN = 100;

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async getReferralDashboard(userId: string) {
    const code = await this.ensureReferralCode(userId);
    const rewards = await this.prisma.referralReward.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        referralCode: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
        eligibleAt: true,
        paidAt: true,
        referredUser: {
          select: {
            fullName: true,
            email: true,
            createdAt: true,
          },
        },
      },
    });

    const summary = rewards.reduce(
      (totals, reward) => {
        totals.invites += 1;
        if (reward.status === ReferralStatus.PAID) {
          totals.paid += Number(reward.amount);
        } else if (
          reward.status === ReferralStatus.PENDING ||
          reward.status === ReferralStatus.ELIGIBLE
        ) {
          totals.pending += Number(reward.amount);
        }
        return totals;
      },
      { invites: 0, pending: 0, paid: 0 },
    );

    return {
      code,
      reward: {
        amount: REFERRAL_REWARD_NGN,
        currency: 'NGN',
      },
      summary,
      referrals: rewards.map((reward) => ({
        id: reward.id,
        amount: Number(reward.amount),
        currency: reward.currency,
        status: reward.status,
        createdAt: reward.createdAt,
        eligibleAt: reward.eligibleAt,
        paidAt: reward.paidAt,
        referredName: this.displayName(
          reward.referredUser.fullName,
          reward.referredUser.email,
        ),
      })),
    };
  }

  async ensureReferralCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.referralCode) {
      return user.referralCode;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const referralCode = this.generateReferralCode();
      try {
        const updated = await this.prisma.user.update({
          where: { id: userId },
          data: { referralCode },
          select: { referralCode: true },
        });
        return updated.referralCode!;
      } catch {
        // Retry on rare unique-code collision.
      }
    }

    throw new BadRequestException('Could not create referral code');
  }

  async recordReferral(referredUserId: string, rawReferralCode?: string) {
    const referralCode = rawReferralCode?.trim().toUpperCase();
    if (!referralCode) return null;

    const referrer = await this.prisma.user.findUnique({
      where: { referralCode },
      select: { id: true },
    });

    if (!referrer || referrer.id === referredUserId) {
      throw new BadRequestException('Referral code is not valid');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: referredUserId },
        data: { referredById: referrer.id },
      });

      return tx.referralReward.upsert({
        where: { referredUserId },
        update: {},
        create: {
          referrerId: referrer.id,
          referredUserId,
          referralCode,
          amount: REFERRAL_REWARD_NGN,
          currency: 'NGN',
          status: ReferralStatus.PENDING,
        },
      });
    });
  }

  private generateReferralCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let index = 0; index < 8; index += 1) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `TP${suffix}`;
  }

  private displayName(fullName: string | null, email: string) {
    if (fullName?.trim()) {
      return fullName.trim();
    }
    return email.split('@')[0] || 'New TRUSTPAY user';
  }
}
