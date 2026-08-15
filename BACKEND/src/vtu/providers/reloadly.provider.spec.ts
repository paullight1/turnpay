import { of, throwError } from 'rxjs';
import { ReloadlyProvider } from './reloadly.provider';

describe('ReloadlyProvider', () => {
  const httpService = {
    get: jest.fn(),
    post: jest.fn(),
  };
  const configValues = {
    NODE_ENV: 'test',
    RELOADLY_CLIENT_ID: 'client-id',
    RELOADLY_CLIENT_SECRET: 'client-secret',
    RELOADLY_AUTH_URL: 'https://auth.reloadly.com/oauth/token',
    RELOADLY_TOPUPS_BASE_URL: 'https://topups-sandbox.reloadly.com',
    RELOADLY_AUDIENCE: 'https://topups-sandbox.reloadly.com',
    RELOADLY_UTILITIES_BASE_URL: 'https://utilities-sandbox.reloadly.com',
    RELOADLY_UTILITIES_AUDIENCE: 'https://utilities-sandbox.reloadly.com',
    RELOADLY_SENDER_COUNTRY_CODE: 'NG',
    RELOADLY_ENABLED: 'true',
  };
  const configService = {
    get: jest.fn(
      (
        key: keyof typeof configValues,
        defaultValue?: string,
      ): string | undefined => configValues[key] || defaultValue,
    ),
  };
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let provider: ReloadlyProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation(
      (
        key: keyof typeof configValues,
        defaultValue?: string,
      ): string | undefined => configValues[key] || defaultValue,
    );
    redis.get.mockResolvedValue(null);
    httpService.post.mockReturnValue(
      of({ data: { access_token: 'access-token', expires_in: 3600 } }),
    );
    provider = new ReloadlyProvider(
      httpService as any,
      configService as any,
      redis as any,
      logger as any,
    );
  });

  it('loads operators for a country using cached OAuth token', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.get.mockReturnValue(
      of({
        data: [{ operatorId: 342, name: 'Airtel Nigeria' }],
      }),
    );

    const result = await provider.getOperators('NG');

    expect(httpService.post).not.toHaveBeenCalled();
    expect(httpService.get).toHaveBeenCalledWith(
      'https://topups-sandbox.reloadly.com/operators/countries/NG',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-token',
        },
      },
    );
    expect(result).toEqual([
      { id: '342', name: 'Airtel Nigeria', type: 'airtime', isActive: true },
    ]);
  });

  it('filters data operators when loading international data providers', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.get.mockReturnValue(
      of({
        data: [
          { operatorId: 100, name: 'Voice Only', data: false },
          { operatorId: 200, name: 'MTN Ghana Data', data: true },
        ],
      }),
    );

    const result = await provider.getOperators('GH', 'data');

    expect(result).toEqual([
      { id: '200', name: 'MTN Ghana Data', type: 'data', isActive: true },
    ]);
  });

  it('auto-detects a Reloadly airtime operator by phone and country', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.get.mockReturnValue(
      of({
        data: {
          operatorId: 342,
          name: 'Airtel Nigeria',
          data: true,
        },
      }),
    );

    const result = await provider.autoDetectOperator({
      phone: '+2348012345678',
      countryCode: 'NG',
      type: 'airtime',
    });

    expect(httpService.get).toHaveBeenCalledWith(
      'https://topups-sandbox.reloadly.com/operators/auto-detect/phone/%2B2348012345678/countries/NG',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-token',
        },
      },
    );
    expect(result).toEqual({
      id: '342',
      name: 'Airtel Nigeria',
      type: 'airtime',
      isActive: true,
      countryCode: 'NG',
    });
  });

  it('returns null when an auto-detected operator does not support data', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.get.mockReturnValue(
      of({
        data: {
          operatorId: 342,
          name: 'Airtel Nigeria',
          data: false,
        },
      }),
    );

    await expect(
      provider.autoDetectOperator({
        phone: '+2348012345678',
        countryCode: 'NG',
        type: 'data',
      }),
    ).resolves.toBeNull();
  });

  it('requests and caches OAuth token when missing', async () => {
    httpService.get.mockReturnValue(of({ data: [] }));

    await provider.getOperators('GH');

    expect(httpService.post).toHaveBeenCalledWith(
      'https://auth.reloadly.com/oauth/token',
      {
        client_id: 'client-id',
        client_secret: 'client-secret',
        grant_type: 'client_credentials',
        audience: 'https://topups-sandbox.reloadly.com',
      },
      { headers: { 'Content-Type': 'application/json' } },
    );
    expect(redis.set).toHaveBeenCalledWith(
      'reloadly:topups:access_token',
      'access-token',
      3540,
    );
  });

  it('loads Reloadly utility electricity billers for Ghana', async () => {
    redis.get.mockResolvedValue('cached-utility-token');
    httpService.get.mockReturnValue(
      of({
        data: {
          content: [
            {
              id: 26,
              name: 'ECG Ghana Prepaid',
              type: 'ELECTRICITY_BILL_PAYMENT',
              serviceType: 'PREPAID',
            },
          ],
        },
      }),
    );

    const result = await provider.getUtilityBillers('GH', 'electricity');

    expect(httpService.get).toHaveBeenCalledWith(
      'https://utilities-sandbox.reloadly.com/billers?type=ELECTRICITY_BILL_PAYMENT&page=1&size=50&countryISOCode=GH',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-utility-token',
          Accept: 'application/com.reloadly.utilities-v1+json',
        },
      },
    );
    expect(result).toEqual([
      {
        id: '26',
        name: 'ECG Ghana Prepaid',
        type: 'electricity',
        isActive: true,
      },
    ]);
  });

  it('submits international airtime top-up requests', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.post.mockReturnValue(
      of({
        data: {
          transactionId: 12345,
          operatorTransactionId: 'operator-tx-should-not-drive-requery',
          status: 'SUCCESSFUL',
          message: 'Top-up successful',
        },
      }),
    );

    const result = await provider.purchase({
      type: 'airtime',
      operatorId: '342',
      countryCode: 'NG',
      recipientNumber: '08011111111',
      amount: 100,
      reference: 'VTU-REF-1',
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'https://topups-sandbox.reloadly.com/topups',
      expect.objectContaining({
        operatorId: 342,
        amount: 100,
        useLocalAmount: false,
        customIdentifier: 'VTU-REF-1',
        recipientPhone: {
          countryCode: 'NG',
          number: '08011111111',
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-token',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        reference: '12345',
        status: 'success',
        message: 'Top-up successful',
        providerRequestId: 'VTU-REF-1',
      }),
    );
  });

  it('submits Reloadly utility electricity payments', async () => {
    redis.get.mockResolvedValue('cached-utility-token');
    httpService.post.mockReturnValue(
      of({
        data: {
          transactionId: 9876,
          referenceId: 'VTU-UTILITY-1',
          status: 'SUCCESSFUL',
          message: 'Payment successful',
        },
      }),
    );

    const result = await provider.payUtilityBill({
      type: 'electricity',
      billerId: '26',
      countryCode: 'GH',
      meterNumber: '12345678901',
      amount: 1000,
      reference: 'VTU-UTILITY-1',
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'https://utilities-sandbox.reloadly.com/pay',
      {
        subscriberAccountNumber: '12345678901',
        amount: 1000,
        billerId: 26,
        useLocalAmount: false,
        referenceId: 'VTU-UTILITY-1',
        additionalInfo: {
          invoiceId: null,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-utility-token',
          Accept: 'application/com.reloadly.utilities-v1+json',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        reference: '9876',
        status: 'success',
        message: 'Payment successful',
        providerRequestId: 'VTU-UTILITY-1',
      }),
    );
  });

  it('requeries Reloadly top-up status by transaction id', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.get.mockReturnValue(
      of({
        data: {
          transactionId: 12345,
          status: 'PROCESSING',
          customIdentifier: 'VTU-REF-1',
          message: 'Still processing',
        },
      }),
    );

    const result = await provider.requery('12345');

    expect(httpService.get).toHaveBeenCalledWith(
      'https://topups-sandbox.reloadly.com/topups/12345/status',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-token',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        reference: '12345',
        status: 'pending',
        providerRequestId: 'VTU-REF-1',
      }),
    );
  });

  it('looks up Reloadly top-up status by transaction id', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.get.mockReturnValue(
      of({
        data: {
          transactionId: 67890,
          status: 'SUCCESSFUL',
          customIdentifier: 'VTU-REF-2',
          message: 'Delivered',
        },
      }),
    );

    const result = await provider.getTopupStatus('67890');

    expect(httpService.get).toHaveBeenCalledWith(
      'https://topups-sandbox.reloadly.com/topups/67890/status',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-token',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        reference: '67890',
        status: 'success',
        providerRequestId: 'VTU-REF-2',
      }),
    );
  });

  it('looks up Reloadly utility payment status by reference id', async () => {
    redis.get.mockResolvedValue('cached-utility-token');
    httpService.get.mockReturnValue(
      of({
        data: {
          content: [
            {
              transactionId: 9876,
              referenceId: 'VTU-UTILITY-1',
              status: 'PROCESSING',
              message: 'Still processing',
            },
          ],
        },
      }),
    );

    const result = await provider.getUtilityPaymentStatus('VTU-UTILITY-1');

    expect(httpService.get).toHaveBeenCalledWith(
      'https://utilities-sandbox.reloadly.com/transactions?referenceId=VTU-UTILITY-1&page=1&size=1',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-utility-token',
          Accept: 'application/com.reloadly.utilities-v1+json',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        reference: '9876',
        status: 'pending',
        providerRequestId: 'VTU-UTILITY-1',
      }),
    );
  });

  it('reports Reloadly health with balance and low-balance warning', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.get.mockReturnValue(
      of({
        data: {
          balance: '8.25',
          currencyCode: 'USD',
        },
      }),
    );

    const result = await provider.getHealth();

    expect(httpService.get).toHaveBeenCalledWith(
      'https://topups-sandbox.reloadly.com/accounts/balance',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cached-token',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'reloadly',
        configured: true,
        enabled: true,
        supportsBalance: true,
        balance: expect.objectContaining({
          status: 'available',
          amount: '8.25',
          currency: 'USD',
        }),
        warnings: expect.arrayContaining([
          'Reloadly balance is below configured threshold of USD 10.',
        ]),
      }),
    );
  });

  it('reports Reloadly balance as unknown when credentials are missing', async () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'RELOADLY_ENABLED') return 'true';
        if (key === 'RELOADLY_CLIENT_ID') return '';
        if (key === 'RELOADLY_CLIENT_SECRET') return '';
        return (configValues as Record<string, string>)[key] || defaultValue;
      },
    );
    provider = new ReloadlyProvider(
      httpService as any,
      configService as any,
      redis as any,
      logger as any,
    );

    const result = await provider.getHealth();

    expect(httpService.get).not.toHaveBeenCalled();
    expect(httpService.post).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        configured: false,
        enabled: true,
        balance: { status: 'unknown' },
        warnings: expect.arrayContaining([
          'Missing Reloadly client credentials.',
        ]),
      }),
    );
  });

  it('treats Reloadly transport errors as unknown provider results', async () => {
    redis.get.mockResolvedValue('cached-token');
    httpService.post.mockReturnValue(throwError(() => new Error('timeout')));

    await expect(
      provider.purchase({
        type: 'airtime',
        operatorId: '342',
        countryCode: 'NG',
        recipientNumber: '08011111111',
        amount: 100,
        reference: 'VTU-REF-1',
      }),
    ).rejects.toThrow('Reloadly provider result unknown');
  });

  it('simulates purchases outside production when Reloadly is disabled', async () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'RELOADLY_ENABLED') return 'false';
        return (configValues as Record<string, string>)[key] || defaultValue;
      },
    );
    provider = new ReloadlyProvider(
      httpService as any,
      configService as any,
      redis as any,
      logger as any,
    );

    const result = await provider.purchase({
      type: 'airtime',
      operatorId: '342',
      countryCode: 'GH',
      recipientNumber: '233501234567',
      amount: 100,
      reference: 'VTU-REF-1',
    });

    expect(httpService.post).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        reference: 'VTU-REF-1',
        status: 'success',
        providerRequestId: 'VTU-REF-1',
      }),
    );
  });

  it('does not expose fallback operators when disabled in production', async () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'RELOADLY_ENABLED') return 'false';
        if (key === 'RELOADLY_CLIENT_ID') return '';
        if (key === 'RELOADLY_CLIENT_SECRET') return '';
        return (configValues as Record<string, string>)[key] || defaultValue;
      },
    );
    provider = new ReloadlyProvider(
      httpService as any,
      configService as any,
      redis as any,
      logger as any,
    );

    await expect(provider.getOperators('GH')).resolves.toEqual([]);
  });

  it('fails closed before purchase when disabled in production', async () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'RELOADLY_ENABLED') return 'false';
        if (key === 'RELOADLY_CLIENT_ID') return '';
        if (key === 'RELOADLY_CLIENT_SECRET') return '';
        return (configValues as Record<string, string>)[key] || defaultValue;
      },
    );
    provider = new ReloadlyProvider(
      httpService as any,
      configService as any,
      redis as any,
      logger as any,
    );

    await expect(
      provider.purchase({
        type: 'airtime',
        operatorId: '342',
        countryCode: 'GH',
        recipientNumber: '233501234567',
        amount: 100,
        reference: 'VTU-REF-1',
      }),
    ).rejects.toThrow('Reloadly provider is not enabled');
  });

  it('fails closed before purchase when enabled in production without credentials', async () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'RELOADLY_ENABLED') return 'true';
        if (key === 'RELOADLY_CLIENT_ID') return '';
        if (key === 'RELOADLY_CLIENT_SECRET') return '';
        return (configValues as Record<string, string>)[key] || defaultValue;
      },
    );

    expect(
      () =>
        new ReloadlyProvider(
          httpService as any,
          configService as any,
          redis as any,
          logger as any,
        ),
    ).toThrow('Reloadly credentials are not configured');
  });
});
