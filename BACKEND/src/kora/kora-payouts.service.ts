import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  KoraClient,
  asRecord,
  parseKoraMoney,
  providerText,
} from './kora.client';

@Injectable()
export class KoraPayoutsService {
  constructor(
    private readonly client: KoraClient,
    private readonly config: ConfigService,
  ) {}
  async resolveRecipient(number: string, operatorSlug: string) {
    if (!/^233\d{9}$/.test(number))
      throw new BadRequestException('Enter a Ghana number starting with 233');
    const operators = await this.client.request<
      Array<{ slug: string; code: string; name: string }>
    >('GET', '/misc/mobile-money', undefined, { countryCode: 'GH' });
    const operator = operators.find((item) => item.slug === operatorSlug);
    if (!operator?.code)
      throw new BadRequestException('Choose an available Ghana MoMo network');
    const result = await this.client.request(
      'POST',
      '/misc/mobile-money/resolve',
      { mobileMoneyCode: operator.code, phoneNumber: number, currency: 'GH' },
    );
    const name = providerText(result.account_name).trim();
    if (!name)
      throw new BadRequestException('The MoMo recipient could not be verified');
    return { name, operator: operatorSlug, number };
  }
  async operators() {
    return this.client.request<
      Array<{ slug: string; code: string; name: string }>
    >('GET', '/misc/mobile-money', undefined, { countryCode: 'GH' });
  }
  async balance() {
    const balances = await this.client.request('GET', '/balances');
    const raw = asRecord(balances.GHS).available_balance;
    const text =
      typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    if (!/^\d+(\.\d{1,2})?$/.test(text))
      throw new ConflictException('Ghana payout balance could not be verified');
    return new Decimal(text);
  }
  async sendMomo(input: {
    reference: string;
    amount: Decimal;
    number: string;
    operator: string;
    name: string;
    email: string;
  }) {
    return this.client.request('POST', '/transactions/disburse', {
      reference: input.reference,
      destination: {
        type: 'mobile_money',
        amount: input.amount,
        currency: 'GHS',
        mobile_money: { operator: input.operator, mobile_number: input.number },
        customer: { name: input.name, email: input.email },
      },
    });
  }
  async verify(
    reference: string,
    expected: { amount: Decimal; number: string; operator: string },
  ) {
    const data = await this.client.request(
      'GET',
      `/transactions/${encodeURIComponent(reference)}`,
    );
    const mobile = asRecord(
      asRecord(data.destination).mobile_money ?? data.mobile_money,
    );
    const number = providerText(mobile.mobile_number).replace(/^\+/, '');
    if (
      data.reference !== reference ||
      data.currency !== 'GHS' ||
      !parseKoraMoney(data.amount).eq(expected.amount) ||
      number !== expected.number ||
      mobile.operator !== expected.operator
    )
      throw new ConflictException(
        'Ghana payout confirmation does not match its destination',
      );
    return providerText(data.status).toLowerCase();
  }
}
