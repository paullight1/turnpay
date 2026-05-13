import { Test, TestingModule } from '@nestjs/testing';
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
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => {
      if (typeof fn === 'function') {
        return fn(mockPrisma);
      }
      return fn;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('provisionWallets', () => {
    it('should create NGN and GHS wallets for a user', async () => {
      mockPrisma.wallet.create.mockResolvedValue(mockWallets[0]);
      mockPrisma.$transaction.mockResolvedValue(mockWallets);

      const wallets = await service.provisionWallets('user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
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
      });
    });
  });
});
