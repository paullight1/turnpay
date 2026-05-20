import { NotFoundException } from '@nestjs/common';
import { SupportService } from './support.service';

describe('SupportService', () => {
  const prisma = {
    transaction: {
      findUnique: jest.fn(),
    },
    dispute: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (input: any) => {
      if (Array.isArray(input)) {
        return Promise.all(input);
      }
      return input(prisma);
    }),
  };

  const logger = {
    info: jest.fn(),
  };

  let service: SupportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupportService(prisma, logger as any);
  });

  it('creates a customer support ticket linked to the user transaction', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
    });
    prisma.dispute.create.mockResolvedValue({
      id: 'ticket-1',
      userId: 'user-1',
      transactionId: 'tx-1',
      type: 'VTU',
      status: 'OPEN',
      description: 'Airtime is still pending after debit',
    });

    const result = await service.createTicket('user-1', {
      category: 'VTU',
      transactionId: 'tx-1',
      description: 'Airtime is still pending after debit',
    });

    expect(prisma.dispute.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        transactionId: 'tx-1',
        type: 'VTU',
        description: 'Airtime is still pending after debit',
      },
      include: expect.any(Object),
    });
    expect(logger.info).toHaveBeenCalledWith(
      { userId: 'user-1', ticketId: 'ticket-1', category: 'VTU' },
      'Support ticket created',
    );
    expect(result.id).toBe('ticket-1');
  });

  it('rejects support ticket links to another user transaction', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'other-user',
    });

    await expect(
      service.createTicket('user-1', {
        category: 'WITHDRAWAL',
        transactionId: 'tx-1',
        description: 'Withdrawal has not landed',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });

  it('routes admin resolution through an audit log with reason', async () => {
    prisma.dispute.findUnique.mockResolvedValue({
      id: 'ticket-1',
      userId: 'user-1',
      transactionId: 'tx-1',
      type: 'WITHDRAWAL',
      status: 'OPEN',
      resolution: null,
    });
    prisma.dispute.update.mockResolvedValue({
      id: 'ticket-1',
      status: 'ESCALATED',
      resolution: 'Escalated to payments operations',
    });

    await service.resolveTicket(
      'ticket-1',
      {
        status: 'ESCALATED',
        resolution: 'Escalated to payments operations',
        reason: 'Provider confirmation is still pending',
      },
      'admin-1',
    );

    expect(prisma.dispute.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: {
        status: 'ESCALATED',
        resolution: 'Escalated to payments operations',
        resolvedBy: 'admin-1',
        resolvedAt: expect.any(Date),
      },
      include: expect.any(Object),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        action: 'SUPPORT_TICKET_RESOLVE',
        targetType: 'Dispute',
        targetId: 'ticket-1',
        reference: 'ticket-1',
        reason: 'Provider confirmation is still pending',
      }),
    });
  });
});
