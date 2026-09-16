import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { SmsProvider } from './sms-provider';

const TWILIO_API_BASE_URL = 'https://api.twilio.com';
const TWILIO_REQUEST_TIMEOUT_MS = 8_000;
const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

type TwilioMessageResponse = {
  sid?: unknown;
};

@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  async sendSms(to: string, body: string): Promise<void> {
    const provider = (this.configService.get<string>('SMS_PROVIDER') ?? '')
      .trim()
      .toLowerCase();
    if (provider !== 'twilio') {
      throw this.unavailable();
    }

    const accountSid = this.getRequiredConfig('TWILIO_ACCOUNT_SID');
    const authToken = this.getRequiredConfig('TWILIO_AUTH_TOKEN');
    const from = this.getRequiredConfig('TWILIO_PHONE_NUMBER');
    if (
      !/^AC[a-zA-Z0-9]{32}$/.test(accountSid) ||
      !E164_PHONE_REGEX.test(from)
    ) {
      throw this.unavailable();
    }

    const form = new URLSearchParams({
      To: to,
      From: from,
      Body: body,
    });
    const authorization = Buffer.from(
      `${accountSid}:${authToken}`,
      'utf8',
    ).toString('base64');

    try {
      const response = await firstValueFrom(
        this.httpService.post<TwilioMessageResponse>(
          `${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${accountSid}/Messages.json`,
          form.toString(),
          {
            headers: {
              Authorization: `Basic ${authorization}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: TWILIO_REQUEST_TIMEOUT_MS,
          },
        ),
      );
      const sid = response.data?.sid;
      if (
        response.status < 200 ||
        response.status >= 300 ||
        typeof sid !== 'string' ||
        sid.length === 0
      ) {
        throw new Error('Twilio returned an invalid message response');
      }
    } catch (error: unknown) {
      const upstreamStatusCode = isAxiosError(error)
        ? error.response?.status
        : undefined;
      const upstreamErrorCode = isAxiosError(error) ? error.code : undefined;
      this.logger.warn(
        {
          provider: 'twilio',
          upstreamStatusCode,
          upstreamErrorCode,
        },
        'OTP SMS delivery failed',
      );
      // There is deliberately no retry here. A timeout can mean Twilio
      // accepted the message, so a second request could deliver a duplicate.
      throw this.unavailable();
    }
  }

  private getRequiredConfig(key: string): string {
    const value = (this.configService.get<string>(key) ?? '').trim();
    if (!value) {
      throw this.unavailable();
    }
    return value;
  }

  private unavailable() {
    return new ServiceUnavailableException('OTP delivery unavailable');
  }
}
