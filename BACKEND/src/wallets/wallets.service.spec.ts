import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WalletsService', () => {
  let service: WalletsService;

  const mockWallets = [
    {
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'wallet-2',
      userId: 'user-1',
      currency: 'GHS',
      balance: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockPrisma = {
    wallet: {
      create: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any): Promise<unknown> => {
      if (typeof fn === 'function') {
        return fn(mockPrisma);
      }
      return fn;
    }),
  };

  const mockPinoLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PinoLogger, useValue: mockPinoLogger },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('provisionWallets', () => {
    it('should create NGN and GHS wallets for a user', async () => {
      const resultWallets = mockWallets.map(
        ({ id, currency, balance, updatedAt }) => ({
          id,
          currency,
          balance,
          updatedAt,
        }),
      );
      mockPrisma.wallet.upsert.mockResolvedValue(mockWallets[0]);
      mockPrisma.wallet.findMany.mockResolvedValue(resultWallets);

      const wallets = await service.provisionWallets('user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.wallet.upsert).toHaveBeenCalledTimes(2);
      expect(mockPinoLogger.info).toHaveBeenCalledWith(
        { userId: 'user-1', walletCount: 2 },
        'Ensured user wallets',
      );
      expect(wallets).toHaveLength(2);
    });
  });

  describe('getWallets', () => {
    it('should return all wallets for a user', async () => {
      const resultWallets = mockWallets.map(
        ({ id, currency, balance, updatedAt }) => ({
          id,
          currency,
          balance,
          updatedAt,
        }),
      );

      mockPrisma.wallet.findMany.mockResolvedValue(resultWallets);

      const result = await service.getWallets('user-1');

      expect(result).toEqual(resultWallets);
      expect(mockPrisma.wallet.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { id: true, currency: true, balance: true, updatedAt: true },
        orderBy: { currency: 'desc' },
      });
    });
  });
});
