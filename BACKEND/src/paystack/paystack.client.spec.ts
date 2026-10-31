import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { PaystackClient } from './paystack.client';

describe('PaystackClient', () => {
  const make = (key = 'sk_test_fixture') => {
    const http = {
      request: jest
        .fn()
        .mockReturnValue(
          of({ data: { status: true, data: { status: 'pending' } } }),
        ),
    };
    const config = new ConfigService({
      PAYSTACK_SECRET_KEY: key,
      NODE_ENV: 'test',
    });
    const breaker = {
      canExecute: jest.fn().mockResolvedValue(true),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    return {
      http,
      client: new PaystackClient(
        http as never,
        config,
        {} as never,
        breaker as never,
      ),
    };
  };
  it('uses the fixed Paystack origin and unwraps provider data', async () => {
    const { http, client } = make();
    await expect(client.request('GET', '/balance')).resolves.toEqual({
      status: 'pending',
    });
    expect(http.request.mock.calls[0][0]).toMatchObject({
      url: 'https://api.paystack.co/balance',
      maxRedirects: 0,
    });
  });
  it('fails closed without a key and never dispatches', async () => {
    const { http, client } = make('');
    await expect(client.request('GET', '/balance')).rejects.toThrow(
      'Paystack is not configured',
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  it('keeps an upstream validation status internal for KYC classification', async () => {
    const { http, client } = make();
    http.request.mockReturnValueOnce(
      of({ status: 400, data: { status: false } }),
    );

    const failure = await client
      .request('POST', '/customer/CUS_fixture123/identification')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadRequestException);
    expect((failure as BadRequestException).cause).toEqual({
      providerStatusCode: 400,
    });
    expect((failure as BadRequestException).getResponse()).toEqual(
      expect.objectContaining({
        message:
          'Paystack could not complete this request. Check the details or contact support.',
      }),
    );
  });

  it('recovers the customer by email when creation succeeded but its response was lost', async () => {
    const { http } = make();
    http.request
      .mockReturnValueOnce(throwError(() => new Error('socket closed')))
      .mockReturnValueOnce(
        of({
          data: {
            status: true,
            data: {
              customer_code: 'CUS_recovered',
              id: 1,
              email: 'owner@example.com',
            },
          },
        }),
      );
    const prisma = {
      paystackCustomer: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          customerCode: 'CUS_recovered',
          customerId: '1',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'owner@example.com',
          fullName: 'Test Customer',
          phone: '+2348012345678',
          isSuspended: false,
        }),
      },
    };
    const circuit = {
      canExecute: jest.fn().mockResolvedValue(true),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const client = new PaystackClient(
      http as never,
      new ConfigService({ PAYSTACK_SECRET_KEY: 'sk_test_fixture' }),
      prisma as never,
      circuit as never,
    );
    await expect(client.ensureCustomer('owner')).resolves.toEqual({
      customerCode: 'CUS_recovered',
      customerId: '1',
    });
    expect(http.request.mock.calls[1][0]).toMatchObject({
      method: 'GET',
      url: 'https://api.paystack.co/customer/owner%40example.com',
    });
  });
});
