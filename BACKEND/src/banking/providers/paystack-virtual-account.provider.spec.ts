import { PaystackVirtualAccountProvider } from './paystack-virtual-account.provider';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

describe('Paystack banking adapter', () => {
  const request = jest.fn();
  const approval = { enabled: true, prepare: jest.fn() };
  const provider = () =>
    new PaystackVirtualAccountProvider(
      { configured: true, request } as never,
      new ConfigService(),
      {} as never,
      approval as never,
    );
  beforeEach(() => {
    request.mockReset();
    approval.prepare.mockReset();
  });
  it('commits the approval binding before dispatch and fails closed if it cannot', async () => {
    request.mockResolvedValueOnce({ recipient_code: 'RCP_test' });
    approval.prepare.mockRejectedValueOnce(new Error('reservation mismatch'));
    await expect(
      provider().initiateTransfer({
        amount: '50.00',
        reference: 'wd_test_reference',
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Recipient',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(request).toHaveBeenCalledTimes(1);
    expect(approval.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'RCP_test',
        amount: 5000,
        currency: 'NGN',
        source: 'balance',
      }),
    );
  });
  it('classifies preparation timeouts as unsent, without hiding an ambiguous transfer POST', async () => {
    request.mockRejectedValueOnce(new Error('recipient timeout'));
    await expect(
      provider().initiateTransfer({
        amount: '50',
        reference: 'wd_test_reference',
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Recipient',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    request.mockReset();
    const uncertain = new Error('transfer POST timeout');
    request
      .mockResolvedValueOnce({ recipient_code: 'RCP_test' })
      .mockRejectedValueOnce(uncertain);
    await expect(
      provider().initiateTransfer({
        amount: '50',
        reference: 'wd_test_reference',
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Recipient',
      }),
    ).rejects.toBe(uncertain);
  });
  it('does not submit transfers when server approval is disabled', async () => {
    const bank = new PaystackVirtualAccountProvider(
      { configured: true, request } as never,
      new ConfigService(),
      {} as never,
    );
    await expect(
      bank.initiateTransfer({
        amount: '50',
        reference: 'wd_test_reference',
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Recipient',
      }),
    ).rejects.toThrow('approval');
    expect(request).not.toHaveBeenCalled();
  });
  it('submits exact kobo and a lowercase stable transfer reference', async () => {
    request
      .mockResolvedValueOnce({ recipient_code: 'RCP_test' })
      .mockResolvedValueOnce({
        status: 'pending',
        reference: 'wd_test_reference',
        transfer_code: 'TRF_test',
      });
    const result = await provider().initiateTransfer({
      amount: '100.01',
      reference: 'wd_test_reference',
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Test Customer',
    });
    expect(request.mock.calls[1]).toEqual([
      'POST',
      '/transfer',
      expect.objectContaining({
        amount: 10001,
        reference: 'wd_test_reference',
        recipient: 'RCP_test',
        source: 'balance',
      }),
    ]);
    expect(result.status).toBe('pending');
  });
  it('rejects fractional kobo before creating a recipient', async () => {
    await expect(
      provider().initiateTransfer({
        amount: '100.001',
        reference: 'wd_test_reference',
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Test Customer',
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects transfer references over the provider 50-character limit before dispatch', async () => {
    await expect(
      provider().initiateTransfer({
        amount: '100.00',
        reference: 'w'.repeat(51),
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Test Customer',
      }),
    ).rejects.toThrow('reference');
    expect(request).not.toHaveBeenCalled();
  });
  it('does not expose merchant OTP operations to a customer', async () => {
    await expect(
      provider().authorizeTransfer({
        reference: 'wd_test_reference',
        authorizationCode: '123456',
      }),
    ).rejects.toThrow('merchant');
    expect(request).not.toHaveBeenCalled();
  });
  it('includes banks from later cursor pages without repeating a cursor', async () => {
    const page = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ name: 'First', code: '001', slug: 'first' }],
        meta: { next: 'cursor_2' },
      })
      .mockResolvedValueOnce({
        data: [{ name: 'Second', code: '002', slug: 'second' }],
        meta: { next: null },
      });
    const banking = new PaystackVirtualAccountProvider(
      { configured: true, request, page } as never,
      new ConfigService(),
      {} as never,
    );
    await expect(banking.listBanks()).resolves.toEqual([
      { name: 'First', code: '001', slug: 'first' },
      { name: 'Second', code: '002', slug: 'second' },
    ]);
    expect(page).toHaveBeenLastCalledWith(
      '/bank',
      expect.objectContaining({ next: 'cursor_2' }),
    );
  });
  const accountInput = {
    userId: 'owner',
    email: 'owner@example.com',
    phone: '+2348012345678',
    accountHolderName: 'Test Customer',
    country: 'NG',
    currency: 'NGN' as const,
  };
  const accountFixture = () => {
    const prisma = {
      paystackCustomer: {
        findUnique: jest.fn().mockResolvedValue({
          customerCode: 'CUS_owner',
          validationStatus: 'VERIFIED',
          accountSetupConsentAt: new Date(),
        }),
      },
      paystackAccountRequest: {
        upsert: jest.fn().mockResolvedValue({ id: 'request' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
    };
    return {
      prisma,
      banking: new PaystackVirtualAccountProvider(
        { configured: true, request } as never,
        new ConfigService(),
        prisma as never,
      ),
    };
  };
  it('recovers an already assigned account without making another creation request', async () => {
    const { banking, prisma } = accountFixture();
    request.mockResolvedValue({
      customer_code: 'CUS_owner',
      dedicated_account: {
        id: 1,
        account_number: '0123456789',
        account_name: 'TRUSTPAY/Test Customer',
        active: true,
        assigned: true,
        currency: 'NGN',
        bank: { name: 'Test Bank' },
      },
    });
    await expect(
      banking.provisionVirtualAccount(accountInput),
    ).resolves.toMatchObject({
      providerCustomerId: 'CUS_owner',
      accountNumber: '0123456789',
      status: 'ACTIVE',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('GET', '/customer/CUS_owner');
    expect(prisma.paystackAccountRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { customerCode: 'CUS_owner' } }),
    );
  });
  it('creates an account using the official provider_slug response after verified BVN', async () => {
    const { banking } = accountFixture();
    request
      .mockResolvedValueOnce({ dedicated_account: null })
      .mockResolvedValueOnce([
        {
          provider_slug: 'titan-paystack',
          bank_id: 629,
          bank_name: 'Paystack-Titan',
          id: 9,
        },
      ])
      .mockResolvedValueOnce({
        id: 1,
        account_number: '0123456789',
        account_name: 'TRUSTPAY/Test Customer',
        active: true,
        assigned: true,
        currency: 'NGN',
        bank: { name: 'Paystack-Titan' },
      });
    await expect(
      banking.provisionVirtualAccount(accountInput),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(request).toHaveBeenLastCalledWith('POST', '/dedicated_account', {
      customer: 'CUS_owner',
      preferred_bank: 'titan-paystack',
    });
  });
  it('validates a configured preferred bank against provider_slug', async () => {
    const { prisma } = accountFixture();
    const banking = new PaystackVirtualAccountProvider(
      { configured: true, request } as never,
      new ConfigService({ PAYSTACK_DVA_PREFERRED_BANK: 'wema-bank' }),
      prisma as never,
    );
    request
      .mockResolvedValueOnce({ dedicated_account: null })
      .mockResolvedValueOnce([
        {
          provider_slug: 'wema-bank',
          bank_id: 20,
          bank_name: 'Wema Bank',
          id: 5,
        },
      ])
      .mockResolvedValueOnce({
        id: 1,
        account_number: '0123456789',
        account_name: 'TRUSTPAY/Test Customer',
        active: true,
        assigned: true,
        currency: 'NGN',
        bank: { name: 'Wema Bank' },
      });
    await banking.provisionVirtualAccount(accountInput);
    expect(request).toHaveBeenLastCalledWith('POST', '/dedicated_account', {
      customer: 'CUS_owner',
      preferred_bank: 'wema-bank',
    });
  });
  it('does not create another account when an assignment response is partial', async () => {
    const { banking, prisma } = accountFixture();
    request.mockResolvedValue({
      dedicated_account: { assigned: false, active: false },
    });
    await expect(banking.provisionVirtualAccount(accountInput)).rejects.toThrow(
      'not active',
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(prisma.paystackAccountRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });
  it('does not dispatch account creation when another worker owns the request', async () => {
    const { banking, prisma } = accountFixture();
    prisma.paystackAccountRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(banking.provisionVirtualAccount(accountInput)).rejects.toThrow(
      'being prepared',
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('does not create a pending account request when the secret is unconfigured', async () => {
    const { prisma } = accountFixture();
    const banking = new PaystackVirtualAccountProvider(
      { configured: false, request } as never,
      new ConfigService(),
      prisma as never,
    );
    await expect(banking.provisionVirtualAccount(accountInput)).rejects.toThrow(
      'not configured',
    );
    expect(prisma.paystackAccountRequest.upsert).not.toHaveBeenCalled();
  });
});
