import { of, throwError } from 'rxjs';
import { VtuApiProvider } from './vtu-api.provider';

describe('VtuApiProvider VTpass adapter', () => {
  const httpService = {
    get: jest.fn(),
    post: jest.fn(),
  };
  const configValues = {
    NODE_ENV: 'test',
    VTU_PROVIDER: 'vtpass',
    VTPASS_BASE_URL: 'https://sandbox.vtpass.com/api',
    VTPASS_API_KEY: 'api-key',
    VTPASS_PUBLIC_KEY: 'public-key',
    VTPASS_SECRET_KEY: 'secret-key',
  };
  const configService = {
    get: jest.fn(
      (key: string): unknown => configValues[key as keyof typeof configValues],
    ),
  };
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const circuitBreaker = {
    canExecute: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };

  let provider: VtuApiProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker.canExecute.mockResolvedValue(true);
    circuitBreaker.recordSuccess.mockResolvedValue(undefined);
    circuitBreaker.recordFailure.mockResolvedValue(undefined);
    configService.get.mockImplementation(
      (key: string): unknown => configValues[key as keyof typeof configValues],
    );
    provider = new (VtuApiProvider as any)(
      httpService as any,
      configService as any,
      logger as any,
      circuitBreaker as any,
    );
  });

  it.each([
    ['smile-airtime', 'airtime', 'smile-direct'],
    ['smile', 'data', 'smile-direct'],
    ['glo-sme', 'data', 'glo-sme-data'],
    ['9mobile-sme', 'data', 'etisalat-sme-data'],
    ['showmax', 'cable', 'showmax'],
    ['foreign-airtime', 'airtime', 'foreign-airtime'],
  ])(
    'loads and purchases %s with its own VTpass fields',
    async (id, type, serviceID) => {
      httpService.get.mockImplementation((url: string) =>
        of({
          data: url.includes('countries')
            ? {
                content: {
                  countries: [{ code: 'GH', name: 'Ghana', prefix: '233' }],
                },
              }
            : url.includes('operators')
              ? { content: [{ operator_id: '5', name: 'Ghana MTN' }] }
              : {
                  content: {
                    variations: [
                      {
                        variation_code: 'plan-1',
                        name: 'Plan',
                        variation_amount: '500',
                        charged_amount: '1500',
                        fixedPrice: 'Yes',
                      },
                    ],
                  },
                },
        }),
      );
      httpService.post.mockReturnValue(
        of({
          data: {
            code: '000',
            content: {
              transactions: { status: 'delivered', transactionId: 'TX-1' },
            },
          },
        }),
      );
      const options =
        id === 'foreign-airtime' ? { countryCode: 'GH', operatorId: '5' } : {};
      const packages = await (provider as any).getPackages(id, options);
      expect(packages[0].price).toBe(
        id === 'foreign-airtime' ? '1500.00' : '500.00',
      );
      await provider.purchase({
        type,
        provider: id,
        amount: packages[0].price,
        packageId: 'plan-1',
        recipientNumber: '+233241234567',
        contactPhone: '+2348031234567',
        reference: 'VTU-test',
        smileAccountId: '1234567890',
        countryCode: 'GH',
        operatorId: '5',
        email: 'buyer@example.com',
      } as any);
      const payload = httpService.post.mock.calls[0][1];
      expect(payload).toMatchObject({ serviceID, variation_code: 'plan-1' });
      if (id.startsWith('smile'))
        expect(payload.billersCode).toBe('1234567890');
      if (id === 'foreign-airtime')
        expect(payload).toMatchObject({
          country_code: 'GH',
          operator_id: '5',
          product_type_id: '1',
          email: 'buyer@example.com',
          billersCode: '233241234567',
        });
      if (id === 'showmax')
        expect(payload).not.toHaveProperty('subscription_type');
    },
  );
  it('does not round a fractional-kobo provider charge into an underpriced package', async () => {
    httpService.get.mockReturnValue(
      of({
        data: {
          content: {
            variations: [
              { variation_code: 'too-precise', variation_amount: '1000.001' },
            ],
          },
        },
      }),
    );
    await expect(provider.getPackages('glo-sme')).resolves.toEqual([]);
  });

  it('does not expose international plans without a positive NGN charge', async () => {
    httpService.get.mockImplementation((url: string) =>
      of({
        data: url.includes('countries')
          ? {
              content: {
                countries: [{ code: 'GH', name: 'Ghana', prefix: '233' }],
              },
            }
          : url.includes('operators')
            ? { content: [{ operator_id: '5', name: 'MTN' }] }
            : {
                content: {
                  variations: [
                    {
                      variation_code: 'free?',
                      variation_amount: '0',
                      fixedPrice: 'Yes',
                    },
                  ],
                },
              },
      }),
    );
    await expect(
      (provider as any).getPackages('foreign-airtime', {
        countryCode: 'GH',
        operatorId: '5',
      }),
    ).resolves.toEqual([]);
  });

  it('maps TRUSTPAY providers to VTpass service providers', async () => {
    await expect(provider.getProviders('airtime')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mtn', type: 'airtime' }),
        expect.objectContaining({ id: '9mobile', type: 'airtime' }),
      ]),
    );
  });

  it('loads data packages through VTpass service variations with GET keys', async () => {
    httpService.get.mockReturnValue(
      of({
        data: {
          content: {
            variations: [
              {
                variation_code: 'mtn-100mb-1000',
                name: 'N1000 1.5GB - 30 days',
                variation_amount: '1000.00',
              },
            ],
          },
        },
      }),
    );

    const packages = await provider.getPackages('mtn');

    expect(httpService.get).toHaveBeenCalledWith(
      'https://sandbox.vtpass.com/api/service-variations',
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': 'api-key',
          'public-key': 'public-key',
        },
        params: { serviceID: 'mtn-data' },
      },
    );
    expect(packages).toEqual([
      {
        id: 'mtn-100mb-1000',
        name: 'N1000 1.5GB - 30 days',
        price: '1000.00',
        validity: '30 days',
        serviceType: 'data',
      },
    ]);
  });

  it('does not replace a failed live catalogue request with simulated prices', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('timeout')));

    await expect(provider.getPackages('mtn')).rejects.toThrow(
      'VTpass packages are temporarily unavailable',
    );
  });

  it('posts airtime purchases to VTpass pay endpoint with secret-key auth', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          response_description: 'TRANSACTION SUCCESSFUL',
          requestId: '202605211122ABC',
          content: {
            transactions: {
              status: 'delivered',
              transactionId: 'provider-tx-1',
            },
          },
        },
      }),
    );

    const result = await provider.purchase({
      type: 'airtime',
      provider: 'mtn',
      contactPhone: '+2348011111111',
      recipientNumber: '08011111111',
      amount: 100,
      reference: 'VTU-1234567890-ABCDEF',
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'https://sandbox.vtpass.com/api/pay',
      expect.objectContaining({
        serviceID: 'mtn',
        amount: '100.00',
        phone: '08011111111',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': 'api-key',
          'secret-key': 'secret-key',
        },
      },
    );
    expect(
      (httpService.post.mock.calls[0][1] as { request_id: string }).request_id,
    ).toMatch(/^\d{12}[A-Za-z0-9]+$/);
    expect(result).toEqual(
      expect.objectContaining({
        reference: 'provider-tx-1',
        status: 'success',
        message: 'TRANSACTION SUCCESSFUL',
        providerRequestId: expect.any(String),
      }),
    );
    expect(circuitBreaker.canExecute).toHaveBeenCalledWith('vtpass');
    expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('vtpass');
  });

  it('uses the selected postpaid meter type and normalized contact phone', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          response_description: 'TRANSACTION SUCCESSFUL',
          requestId: '202609031122ABC',
          content: {
            transactions: {
              status: 'delivered',
              transactionId: 'provider-electricity-1',
            },
          },
        },
      }),
    );

    await provider.purchase({
      type: 'electricity',
      provider: 'ikedc',
      contactPhone: '+2348031234567',
      amount: '1000.00',
      reference: 'VTU-ELECTRICITY-1',
      meterNumber: '1111111111111',
      meterType: 'postpaid',
    } as any);

    expect(httpService.post.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        serviceID: 'ikeja-electric',
        billersCode: '1111111111111',
        variation_code: 'postpaid',
        amount: '1000.00',
        phone: '08031234567',
      }),
    );
  });

  it('maps cable renewal without a bouquet variation', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          response_description: 'TRANSACTION SUCCESSFUL',
          content: {
            transactions: {
              status: 'delivered',
              transactionId: 'provider-cable-1',
            },
          },
        },
      }),
    );

    await provider.purchase({
      type: 'cable',
      provider: 'dstv',
      contactPhone: '+2348031234567',
      amount: '6500.00',
      reference: 'VTU-CABLE-1',
      smartCardNumber: '1212121212',
      subscriptionType: 'renew',
    } as any);

    expect(httpService.post.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        serviceID: 'dstv',
        billersCode: '1212121212',
        subscription_type: 'renew',
        amount: '6500.00',
        phone: '08031234567',
      }),
    );
    expect(httpService.post.mock.calls[0][1]).not.toHaveProperty(
      'variation_code',
    );
  });

  it('extracts purchased codes and provider economics without persisting raw PII', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          response_description: 'TRANSACTION SUCCESSFUL',
          requestId: '202609031122ABC',
          purchased_code: '1234-5678-9012-3456-7890',
          content: {
            transactions: {
              status: 'delivered',
              transactionId: 'provider-electricity-2',
              unique_element: '1111111111111',
              phone: '08031234567',
              email: 'customer@example.com',
              total_amount: '970.00',
              commission: '30.00',
            },
          },
        },
      }),
    );

    const result = await provider.purchase({
      type: 'electricity',
      provider: 'ikedc',
      contactPhone: '+2348031234567',
      amount: '1000.00',
      reference: 'VTU-ELECTRICITY-2',
      meterNumber: '1111111111111',
      meterType: 'prepaid',
    } as any);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        purchasedCode: '1234-5678-9012-3456-7890',
        providerCost: '970.00',
        providerCommission: '30.00',
      }),
    );
    expect(JSON.stringify(result.safeResponse)).not.toContain('1111111111111');
    expect(JSON.stringify(result.safeResponse)).not.toContain('08031234567');
    expect(JSON.stringify(result.safeResponse)).not.toContain(
      'customer@example.com',
    );
    expect(JSON.stringify(result.safeResponse)).not.toContain(
      '1234-5678-9012-3456-7890',
    );
  });

  it('keeps VTpass reversal distinct from an outright failure', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          response_description: 'TRANSACTION REVERSAL TO WALLET',
          requestId: '202609031122REV',
          amount: '48.50',
          content: {
            transactions: {
              status: 'reversed',
              amount: '50.00',
              total_amount: '48.50',
              transactionId: 'provider-reversal-1',
              wallet_credit_id: 'wallet-credit-1',
            },
          },
        },
      }),
    );

    await expect(provider.requery('202609031122REV')).resolves.toEqual(
      expect.objectContaining({
        status: 'reversed',
        providerRequestId: '202609031122REV',
        providerAmount: '48.50',
        providerCurrency: 'NGN',
        walletCreditId: 'wallet-credit-1',
      }),
    );
  });

  it('fails closed when simulation is not explicitly enabled', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'VTU_SIMULATION_ENABLED') return false;
      return '';
    });
    const unconfigured = new (VtuApiProvider as any)(
      httpService as any,
      configService as any,
      logger as any,
      circuitBreaker as any,
    );

    await expect(
      unconfigured.purchase({
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348031234567',
        recipientNumber: '+2348031234567',
        amount: '100.00',
        reference: 'VTU-NO-CONFIG-1',
      }),
    ).rejects.toThrow('VTpass is not configured');
  });

  it('requeries VTpass transactions by provider request id', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          response_description: 'TRANSACTION SUCCESSFUL',
          requestId: '202605211122ABC',
          content: {
            transactions: {
              status: 'delivered',
              transactionId: 'provider-tx-1',
            },
          },
        },
      }),
    );

    const result = await provider.requery('202605211122ABC');

    expect(httpService.post).toHaveBeenCalledWith(
      'https://sandbox.vtpass.com/api/requery',
      { request_id: '202605211122ABC' },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': 'api-key',
          'secret-key': 'secret-key',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        reference: 'provider-tx-1',
        status: 'success',
        providerRequestId: '202605211122ABC',
      }),
    );
  });

  it('reports VTpass health with balance and low-balance warning', async () => {
    httpService.get.mockReturnValue(
      of({
        data: {
          code: '000',
          contents: {
            balance: '1200.50',
          },
        },
      }),
    );

    const result = await provider.getVtpassHealth();

    expect(httpService.get).toHaveBeenCalledWith(
      'https://sandbox.vtpass.com/api/balance',
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': 'api-key',
          'public-key': 'public-key',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'vtpass',
        configured: true,
        enabled: true,
        supportsBalance: true,
        balance: expect.objectContaining({
          status: 'available',
          amount: '1200.5',
          currency: 'NGN',
        }),
        warnings: expect.arrayContaining([
          'VTpass balance is below configured threshold of NGN 5000.',
        ]),
      }),
    );
  });

  it('reports VTpass balance as unknown when credentials are missing', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'VTU_PROVIDER') return 'vtpass';
      return '';
    });
    provider = new VtuApiProvider(
      httpService as any,
      configService as any,
      logger as any,
      circuitBreaker as any,
    );

    const result = await provider.getVtpassHealth();

    expect(httpService.get).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        configured: false,
        enabled: true,
        balance: { status: 'unknown', currency: 'NGN' },
        warnings: expect.arrayContaining([
          'Missing VTpass apiKey configuration.',
          'Missing VTpass publicKey configuration.',
          'Missing VTpass secretKey configuration.',
        ]),
      }),
    );
  });

  it('normalizes VTpass processing responses as pending', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '099',
          response_description: 'TRANSACTION IS PROCESSING',
        },
      }),
    );

    await expect(
      provider.purchase({
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348011111111',
        recipientNumber: '201000000000',
        amount: 100,
        reference: 'VTU-1234567890-PENDING',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'pending',
        message: 'TRANSACTION IS PROCESSING',
      }),
    );
  });

  it('verifies meters through VTpass merchant-verify with secret-key auth', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          content: {
            Customer_Name: 'TESTMETER1',
            Address: 'ABULE EGBA BU ABULE',
          },
        },
      }),
    );

    const result = await provider.validateMeter('ikedc', '1111111111111');

    expect(httpService.post).toHaveBeenCalledWith(
      'https://sandbox.vtpass.com/api/merchant-verify',
      {
        serviceID: 'ikeja-electric',
        billersCode: '1111111111111',
        type: 'prepaid',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': 'api-key',
          'secret-key': 'secret-key',
        },
      },
    );
    expect(result).toEqual({
      name: 'TESTMETER1',
      address: 'ABULE EGBA BU ABULE',
    });
  });

  it('verifies smart cards through VTpass merchant-verify', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          content: {
            Customer_Name: 'TEST METER',
            Status: 'ACTIVE',
          },
        },
      }),
    );

    const result = await provider.validateSmartCard('dstv', '1212121212');

    expect(httpService.post).toHaveBeenCalledWith(
      'https://sandbox.vtpass.com/api/merchant-verify',
      { serviceID: 'dstv', billersCode: '1212121212' },
      expect.anything(),
    );
    expect(result).toEqual({ name: 'TEST METER', status: 'active' });
  });

  it('rejects merchant verification when VTpass reports an error', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: '000',
          content: { error: 'INVALID METER NUMBER' },
        },
      }),
    );

    await expect(
      provider.validateMeter('ikedc', '0000000000000'),
    ).rejects.toThrow(
      'We could not verify this customer number. Check it and try again.',
    );
  });

  it('surfaces merchant verification transport failures as unavailable', async () => {
    httpService.post.mockReturnValue(throwError(() => new Error('timeout')));

    await expect(
      provider.validateMeter('ikedc', '1111111111111'),
    ).rejects.toThrow(
      'Customer verification is temporarily unavailable. Try again shortly.',
    );
  });

  it('treats transport errors as unknown provider results', async () => {
    httpService.post.mockReturnValue(throwError(() => new Error('timeout')));

    await expect(
      provider.purchase({
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348011111111',
        recipientNumber: '300000000000',
        amount: 100,
        reference: 'VTU-1234567890-TIMEOUT',
      }),
    ).rejects.toThrow('VTU provider result unknown');
  });
});
