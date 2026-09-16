import { MonnifyKycSyncService } from './monnify-kyc-sync.service';

describe('MonnifyKycSyncService', () => {
  const date = new Date('2026-09-05T00:00:00Z');
  let account: any;
  let prisma: any;
  let provider: any;
  let service: MonnifyKycSyncService;
  beforeEach(() => {
    account = {
      id: 'va-1',
      userId: 'u-1',
      provider: 'MONNIFY',
      currency: 'NGN',
      status: 'ACTIVE',
      metadata: {},
      updatedAt: date,
      user: {
        kycStatus: 'VERIFIED',
        kycTier: 'TIER_2',
        isSuspended: false,
        kycDocuments: [
          { id: 'b-1', type: 'BVN', idNumber: '12345678901', updatedAt: date },
          { id: 'n-1', type: 'NIN', idNumber: '12345678902', updatedAt: date },
        ],
      },
    };
    prisma = {
      virtualAccount: {
        findUnique: jest.fn(async () => account),
        updateMany: jest.fn(async ({ data }) => {
          account.metadata = data.metadata;
          return { count: 1 };
        }),
      },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    provider = {
      updateReservedAccountKyc: jest.fn().mockResolvedValue(undefined),
    };
    service = new MonnifyKycSyncService(
      prisma,
      provider,
      { get: jest.fn() } as any,
      { warn: jest.fn() } as any,
    );
  });
  it('syncs verified identifiers once and persists a safe success marker', async () => {
    await service.syncAccount('va-1');
    await service.syncAccount('va-1');
    expect(provider.updateReservedAccountKyc).toHaveBeenCalledTimes(1);
    expect(provider.updateReservedAccountKyc).toHaveBeenCalledWith(
      'TP-NGN-u-1',
      { bvn: '12345678901', nin: '12345678902' },
    );
    expect(account.metadata.monnifyKycSync.status).toBe('SYNCED');
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      '12345678901',
    );
    expect(JSON.stringify(account.metadata)).not.toContain('12345678901');
  });
  it('records a retry after provider failure without storing sensitive errors', async () => {
    provider.updateReservedAccountKyc.mockRejectedValue(
      new Error('12345678901'),
    );
    await service.syncAccount('va-1');
    await service.syncAccount('va-1');
    expect(provider.updateReservedAccountKyc).toHaveBeenCalledTimes(1);
    expect(account.metadata.monnifyKycSync.status).toBe('FAILED');
    expect(JSON.stringify(account.metadata)).not.toContain('12345678901');
    account.metadata.monnifyKycSync.retryAt = date.toISOString();
    provider.updateReservedAccountKyc.mockResolvedValue(undefined);
    await service.syncAccount('va-1');
    expect(account.metadata.monnifyKycSync.status).toBe('SYNCED');
  });
  it('does not call provider when another worker wins the claim', async () => {
    prisma.virtualAccount.updateMany.mockResolvedValue({ count: 0 });
    await service.syncAccount('va-1');
    expect(provider.updateReservedAccountKyc).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'REJECTED'])('does not sync %s users', async (status) => {
    account.user.kycStatus = status;
    await service.syncAccount('va-1');
    expect(provider.updateReservedAccountKyc).not.toHaveBeenCalled();
  });
  it('syncs the remaining verified identifier for a limited account', async () => {
    account.user.kycDocuments.pop();
    await service.syncAccount('va-1');
    expect(provider.updateReservedAccountKyc).toHaveBeenCalledWith(
      'TP-NGN-u-1',
      { bvn: '12345678901' },
    );
  });
});
