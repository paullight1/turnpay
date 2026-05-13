import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ExchangeService } from './exchange.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateService } from './providers/rate.service';
import { RedisService } from '../redis/redis.service';
import { PinoLogger } from 'nestjs-pino';

describe('ExchangeService', () => {
  let service: ExchangeService;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const mockPrisma = {
    $transaction: jest.fn(),
    wallet: { findFirst: jest.fn(), update: jest.fn() },
    transaction: { create: jest.fn() },
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
});
