import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Prisma } from '@prisma/client';

describe('UsersService identity updates', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (work) => work(prisma));
    service = new UsersService(prisma as never);
  });

  it('blocks identity changes after KYC verification', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      phone: '+2348012345678',
      fullName: 'Ada Example',
      country: 'NG',
      yearOfBirth: 1990,
      profileDetailsUpdatedAt: null,
      kycStatus: 'VERIFIED',
      wallets: [],
    });

    await expect(
      service.update('user-1', { fullName: 'Different Identity' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('atomically audits the one allowed pre-KYC identity update', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      phone: '+2348012345678',
      fullName: null,
      country: 'NG',
      yearOfBirth: null,
      profileDetailsUpdatedAt: null,
      kycStatus: 'PENDING',
      wallets: [],
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      phone: '+2348012345678',
      fullName: 'Ada Example',
      country: 'NG',
      yearOfBirth: 1990,
      profileDetailsUpdatedAt: new Date(),
      kycStatus: 'PENDING',
    });

    await service.update('user-1', {
      fullName: 'Ada Example',
      yearOfBirth: 1990,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user_identity_profile_updated',
        targetType: 'USER',
        targetId: 'user-1',
        metadata: { actorUserId: 'user-1' },
      }),
    });
  });

  it('returns a correctable phone conflict instead of an internal server error', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: '+2348012345678',
      country: 'NG',
      kycStatus: 'PENDING',
      profileDetailsUpdatedAt: null,
    });
    prisma.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['phone'] },
      }),
    );
    await expect(
      service.update('user-1', { phone: '+2348012345679' }),
    ).rejects.toMatchObject({
      response: {
        code: 'PROFILE_PHONE_IN_USE',
        message:
          'This phone number is already linked to another account. Use your own registered number or contact support.',
      },
    });
  });
});
