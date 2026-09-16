import { ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { TwilioSmsProvider } from './twilio.provider';

describe('TwilioSmsProvider', () => {
  const httpService = { post: jest.fn() };
  const configValues: Record<string, string> = {
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_AUTH_TOKEN: 'test-auth-token',
    TWILIO_PHONE_NUMBER: '+15557122661',
  };
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const logger = {
    warn: jest.fn(),
  };

  let provider: TwilioSmsProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => configValues[key]);
    provider = new TwilioSmsProvider(
      httpService as never,
      configService as never,
      logger as never,
    );
  });

  it('posts an URL-encoded SMS to Twilio with Basic authentication', async () => {
    httpService.post.mockReturnValue(
      of({
        status: 201,
        data: { sid: `SM${'b'.repeat(32)}`, status: 'queued' },
      }),
    );

    await expect(
      provider.sendSms(
        '+2348012345678',
        'Your TrustPay verification code is: 123456.',
      ),
    ).resolves.toBeUndefined();

    expect(httpService.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = httpService.post.mock.calls[0];
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${configValues.TWILIO_ACCOUNT_SID}/Messages.json`,
    );
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      To: '+2348012345678',
      From: '+15557122661',
      Body: 'Your TrustPay verification code is: 123456.',
    });
    expect(options).toEqual({
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${configValues.TWILIO_ACCOUNT_SID}:${configValues.TWILIO_AUTH_TOKEN}`,
        ).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 8_000,
    });
  });

  it('fails closed on provider errors without retrying or logging secrets', async () => {
    const twilioError = Object.assign(new Error('provider error'), {
      response: { status: 429 },
      code: 'ERR_BAD_RESPONSE',
      isAxiosError: true,
    });
    httpService.post.mockReturnValueOnce(throwError(() => twilioError));
    const message = 'Your TrustPay verification code is: 654321.';

    await expect(
      provider.sendSms('+2348012345678', message),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(httpService.post).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(message);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      configValues.TWILIO_AUTH_TOKEN,
    );
  });

  it('rejects missing production configuration before making an upstream call', async () => {
    configValues.TWILIO_AUTH_TOKEN = '';

    await expect(
      provider.sendSms('+2348012345678', 'verification message'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(httpService.post).not.toHaveBeenCalled();

    configValues.TWILIO_AUTH_TOKEN = 'test-auth-token';
  });
});
