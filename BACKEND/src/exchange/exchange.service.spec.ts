import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ExchangeService } from './exchange.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateService } from './providers/rate.service';
import { RedisService } from '../redis/redis.service';
import { PinoLogger } from 'nestjs-pino';
import { LedgerService } from '../wallets/ledger.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('ExchangeService', () => {
  let service: ExchangeService;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const mockPrisma = {
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
    wallet: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    transaction: { create: jest.fn() },
  };

  const mockLedger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };

  const mockRateService = {
    getRate: jest.fn().mockResolvedValue({ rate: 3.1746, markup: 2.5 }),
  };

  const mockPinoLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({ JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d' }),
          ],
        }),
      ],
      providers: [
        ExchangeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RateService, useValue: mockRateService },
        { provide: RedisService, useValue: mockRedis },
        { provide: PinoLogger, useValue: mockPinoLogger },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createQuote', () => {
    it('should throw error if from and to currencies are the same', async () => {
      await expect(
        service.createQuote('user-1', { from: 'GHS', to: 'GHS', amount: 100 }),
      ).rejects.toThrow('Source and destination currencies must be different');
    });

    it('should create a quote and store in Redis', async () => {
      const quote = await service.createQuote('user-1', {
        from: 'GHS',
        to: 'NGN',
        amount: 100,
      });

      expect(quote.id).toBeDefined();
      expect(quote.userId).toBe('user-1');
      expect(quote.from).toBe('GHS');
      expect(quote.to).toBe('NGN');
      expect(quote.amount).toBe(100);
      expect(quote.rate).toBeGreaterThan(0);
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe('executeQuote', () => {
    it('posts exchange debit and credit through the ledger in one transaction', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          id: 'quote-1',
          userId: 'user-1',
          from: 'NGN',
          to: 'GHS',
          amount: 100,
          rate: 0.1,
          markupPercent: 2.5,
          fee: 2,
          sendAmount: 102,
          receiveAmount: 10,
          expiresAt,
          createdAt: new Date(),
        }),
      );
      mockPrisma.wallet.findUnique
        .mockResolvedValueOnce({
          id: 'wallet-ngn',
        })
        .mockResolvedValueOnce({
          id: 'wallet-ghs',
        });
      mockPrisma.wallet.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.wallet.update.mockResolvedValue({
        id: 'wallet-ghs',
        balance: new Decimal(60),
        currency: 'GHS',
      });
      mockPrisma.wallet.findUniqueOrThrow.mockResolvedValue({
        id: 'wallet-ngn',
        balance: new Decimal(898),
        currency: 'NGN',
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: 'tx-1',
        reference: 'EXC-1',
        type: 'EXCHANGE',
        amount: new Decimal(100),
        fee: new Decimal(2),
        currency: 'NGN',
        status: 'SUCCESS',
        createdAt: new Date(),
      });
      mockLedger.debitWallet.mockResolvedValue({
        walletId: 'wallet-ngn',
        balanceAfter: new Decimal(898),
      });
      mockLedger.creditWallet.mockResolvedValue({
        walletId: 'wallet-ghs',
        balanceAfter: new Decimal(60),
      });

      await service.executeQuote('user-1', { quoteId: 'quote-1' });

      expect(mockLedger.debitWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          currency: 'NGN',
          amount: new Decimal(102),
          transactionId: 'tx-1',
          source: 'EXCHANGE_DEBIT',
        }),
        mockPrisma,
      );
      expect(mockLedger.creditWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          currency: 'GHS',
          amount: new Decimal(10),
          transactionId: 'tx-1',
          source: 'EXCHANGE_CREDIT',
        }),
        mockPrisma,
      );
    });
  });
});
