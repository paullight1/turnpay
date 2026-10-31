import { bootstrapInitialAdmin } from './bootstrap-initial-admin';

describe('initial administrator provisioning', () => {
  const account = {
    id: 'staff-1',
    email: 'reviewer@example.test',
    role: 'USER',
    isSuspended: false,
  };
  const prisma = {
    user: { findUnique: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const verifyIdentity = jest.fn();
  const input = {
    email: account.email,
    reason: 'Owner designated initial NIN reviewer',
    apply: false,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue(account);
    prisma.user.count.mockResolvedValue(0);
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    verifyIdentity.mockResolvedValue({
      id: account.id,
      email: account.email,
      confirmed: true,
      banned: false,
    });
  });

  it('previews the exact existing account without changing privileges', async () => {
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, input),
    ).resolves.toEqual({ userId: account.id, status: 'DRY_RUN' });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('requires a confirmed matching auth identity and refuses suspended accounts', async () => {
    verifyIdentity.mockResolvedValueOnce({
      id: account.id,
      email: account.email,
      confirmed: false,
      banned: false,
    });
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        ...input,
        apply: true,
      }),
    ).rejects.toThrow('confirmed');
    verifyIdentity.mockResolvedValueOnce({
      id: 'other-user',
      email: account.email,
      confirmed: true,
      banned: false,
    });
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        ...input,
        apply: true,
      }),
    ).rejects.toThrow('match');
    prisma.user.findUnique.mockResolvedValueOnce({
      ...account,
      isSuspended: true,
    });
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        ...input,
        apply: true,
      }),
    ).rejects.toThrow('suspended');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a second administrator and never creates a user or password', async () => {
    prisma.user.count.mockResolvedValueOnce(1);
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        ...input,
        apply: true,
      }),
    ).rejects.toThrow('already exists');
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        ...input,
        apply: true,
      }),
    ).rejects.toThrow('existing');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('atomically records an explicit role assignment and an operator audit', async () => {
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        ...input,
        apply: true,
      }),
    ).resolves.toEqual({ userId: account.id, status: 'PROVISIONED' });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: account.id, role: 'USER', isSuspended: false },
      data: { role: 'ADMIN' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'INITIAL_ADMIN_PROVISIONED',
        targetId: account.id,
        reason: input.reason,
        before: { role: 'USER' },
        after: { role: 'ADMIN' },
        metadata: expect.objectContaining({
          operatorProcessUser: expect.any(String),
        }),
      }),
    });
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      account.email,
    );
  });

  it('replaying setup for the same administrator makes no further changes', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...account, role: 'ADMIN' });
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        ...input,
        apply: true,
      }),
    ).resolves.toEqual({ userId: account.id, status: 'ALREADY_ADMIN' });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('validates email, reason and apply before accessing an account', async () => {
    await expect(
      bootstrapInitialAdmin(prisma as never, verifyIdentity, {
        email: 'bad',
        reason: 'x',
        apply: true,
      }),
    ).rejects.toThrow('Invalid');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
