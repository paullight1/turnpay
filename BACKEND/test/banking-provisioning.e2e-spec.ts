import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { from, isObservable, lastValueFrom } from 'rxjs';
import { ExecutionContext } from '@nestjs/common';
import { BankingController } from '../src/banking/banking.controller';
import { BankingService } from '../src/banking/banking.service';
import { BeneficiariesService } from '../src/banking/beneficiaries.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { PinoLogger } from 'nestjs-pino';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { businessRequestFingerprint } from '../src/common/utils/financial-request';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { SupabaseService } from '../src/supabase/supabase.service';
import { ProvisionVirtualAccountDto } from '../src/banking/dto/banking.dto';

describe('Banking — Virtual Account Provisioning (e2e simulated)', () => {
  const mockBankingService = {
    getVirtualAccounts: jest.fn(),
    provisionVirtualAccount: jest.fn(),
  };

  const mockBeneficiariesService = {
    listBanks: jest.fn(),
    resolveBankAccount: jest.fn(),
    createBeneficiary: jest.fn(),
    getBeneficiaries: jest.fn(),
    deleteBeneficiary: jest.fn(),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    setIfNotExists: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    isAvailable: jest.fn(),
  };

  const mockPrisma = {
    idempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };

  const mockJwtAuthGuard = {
    canActivate: jest.fn(() => true),
  };

  const mockSupabaseService = {
    verifyToken: jest.fn(),
    syncUser: jest.fn(),
  };

  const hash = (value: unknown) =>
    `business:v2:${createHash('sha256')
      .update(JSON.stringify(businessRequestFingerprint(value ?? {})))
      .digest('hex')}`;

  let bankingController: BankingController;
  let interceptor: IdempotencyInterceptor;

  const makeContext = (opts: {
    idempotencyKey: string;
    path: string;
    body: unknown;
    userId?: string;
  }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: opts.path,
          headers: { 'idempotency-key': opts.idempotencyKey },
          body: opts.body,
          user: {
            userId: opts.userId ?? 'user-tier2-verified',
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  const execute = async <T>(
    context: ExecutionContext,
    handler: () => Promise<T>,
  ): Promise<T> => {
    const result = await interceptor.intercept(context, {
      handle: () => from(handler()),
    });

    if (isObservable(result)) {
      return lastValueFrom(result) as Promise<T>;
    }

    return result;
  };

  const provisionedAccount = {
    id: 'va-1',
    provider: 'MONNIFY',
    accountNumber: '9922334455',
    accountNumberMasked: '*****4455',
    accountName: 'Test User TrustPay',
    bankName: 'Wema Bank',
    bankCode: '035',
    currency: 'NGN',
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.isAvailable.mockReturnValue(false);
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.idempotencyRecord.findUnique.mockReset();
    mockPrisma.idempotencyRecord.create.mockReset();
    mockPrisma.idempotencyRecord.create.mockResolvedValue({
      id: 'idem-replay',
    });
    mockPrisma.idempotencyRecord.update.mockReset();
    mockPrisma.idempotencyRecord.update.mockResolvedValue({
      id: 'idem-replay',
    });
    mockBankingService.provisionVirtualAccount.mockResolvedValue(
      provisionedAccount,
    );
    mockBankingService.getVirtualAccounts.mockResolvedValue([
      provisionedAccount,
    ]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [BankingController],
      providers: [
        { provide: BankingService, useValue: mockBankingService },
        { provide: BeneficiariesService, useValue: mockBeneficiariesService },
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    bankingController = moduleRef.get(BankingController);
    interceptor = new IdempotencyInterceptor(
      mockRedis as unknown as RedisService,
      mockPrisma as unknown as PrismaService,
      mockLogger as unknown as PinoLogger,
    );
  });

  // ─── Scenario 1: Successful virtual account provisioning ─────────────────
  it('provisions a Monnify virtual account for a verified Tier 2 user', async () => {
    const requestBody: ProvisionVirtualAccountDto = {
      currency: 'NGN',
      provider: 'monnify',
      country: 'NG',
      firstName: 'Test',
      lastName: 'User',
    };

    const context = makeContext({
      idempotencyKey: 'provision-key-001-test',
      path: '/api/banking/accounts/provision',
      body: requestBody,
    });

    const result = await execute(context, () =>
      bankingController.provisionVirtualAccount(
        { userId: 'user-tier2-verified' },
        requestBody,
        undefined,
        'provision-key-001-test',
      ),
    );

    expect(result).toEqual(provisionedAccount);
    expect(result.accountNumber).toBe('9922334455');
    expect(result.accountNumberMasked).toBe('*****4455');
    expect(result.bankName).toBe('Wema Bank');
    expect(result.status).toBe('ACTIVE');
    expect(mockBankingService.provisionVirtualAccount).toHaveBeenCalledTimes(1);
  });

  // ─── Scenario 2: Duplicate idempotency key returns same account ──────────
  it('returns the same virtual account when the same Idempotency-Key is reused', async () => {
    const requestBody: ProvisionVirtualAccountDto = {
      currency: 'NGN',
      provider: 'monnify',
      country: 'NG',
      firstName: 'Test',
      lastName: 'User',
    };

    mockPrisma.idempotencyRecord.create.mockResolvedValue({ id: 'idem-1' });
    mockPrisma.idempotencyRecord.update.mockResolvedValue({});
    mockPrisma.idempotencyRecord.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        requestHash: hash(requestBody),
        status: 'COMPLETED',
        response: provisionedAccount,
      });

    const context = makeContext({
      idempotencyKey: 'provision-key-002-test',
      path: '/api/banking/accounts/provision',
      body: requestBody,
    });

    const first = await execute(context, () =>
      bankingController.provisionVirtualAccount(
        { userId: 'user-tier2-verified' },
        requestBody,
        undefined,
        'provision-key-002-test',
      ),
    );

    const second = await execute(context, () =>
      bankingController.provisionVirtualAccount(
        { userId: 'user-tier2-verified' },
        requestBody,
        undefined,
        'provision-key-002-test',
      ),
    );

    expect(first).toEqual(provisionedAccount);
    expect(second).toEqual(provisionedAccount);
    // Service called only once — idempotency cache returned the replay
    expect(mockBankingService.provisionVirtualAccount).toHaveBeenCalledTimes(1);
  });

  // ─── Scenario 3: KYC gate blocks unverified user ────────────────────────
  it('blocks provisioning for users without verified KYC status', async () => {
    mockBankingService.provisionVirtualAccount.mockRejectedValue(
      new Error('KYC verification required to provision a virtual account'),
    );

    const requestBody: ProvisionVirtualAccountDto = {
      currency: 'NGN',
      provider: 'monnify',
      country: 'NG',
      firstName: 'Unverified',
      lastName: 'User',
    };

    const context = makeContext({
      idempotencyKey: 'provision-key-003-test',
      path: '/api/banking/accounts/provision',
      body: requestBody,
      userId: 'user-unverified',
    });

    await expect(
      execute(context, () =>
        bankingController.provisionVirtualAccount(
          { userId: 'user-unverified' },
          requestBody,
          undefined,
          'provision-key-003-test',
        ),
      ),
    ).rejects.toThrow();

    expect(mockBankingService.provisionVirtualAccount).toHaveBeenCalledWith(
      'user-unverified',
      requestBody,
      'provision-key-003-test',
    );
  });

  // ─── Scenario 4: Gets all virtual accounts for a user ───────────────────
  it('retrieves all virtual accounts for the authenticated user', async () => {
    const result = await bankingController.getVirtualAccounts({
      userId: 'user-tier2-verified',
    });

    expect(result).toEqual([provisionedAccount]);
    expect(mockBankingService.getVirtualAccounts).toHaveBeenCalledWith(
      'user-tier2-verified',
    );
  });

  // ─── Scenario 5: User sees only their own virtual accounts ───────────────
  it('only returns virtual accounts belonging to the authenticated user', async () => {
    mockBankingService.getVirtualAccounts.mockResolvedValueOnce([]);

    const result = await bankingController.getVirtualAccounts({
      userId: 'user-other',
    });

    expect(result).toEqual([]);
    expect(mockBankingService.getVirtualAccounts).toHaveBeenCalledWith(
      'user-other',
    );
  });
});
