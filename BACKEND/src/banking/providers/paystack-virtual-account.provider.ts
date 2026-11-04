import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { PaystackClient } from '../../paystack/paystack.client';
import { PaystackTransferApprovalService } from '../../paystack/paystack-transfer-approval.service';
import { toMinorUnit } from '../../payments/utils/provider-amount';
import {
  ProviderVirtualAccount,
  ProvisionVirtualAccountInput,
} from './banking-provider.types';

type Data = Record<string, unknown>;
const providerText = (value: unknown, fallback = '') =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? value.toString()
      : fallback;
type TransferInput = {
  amount: string;
  reference: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  narration?: string;
  sourceAccountNumber?: string;
  currency?: 'NGN';
  async?: boolean;
};

@Injectable()
export class PaystackVirtualAccountProvider {
  constructor(
    private readonly client: PaystackClient,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Optional() private readonly approval?: PaystackTransferApprovalService,
  ) {}

  get configured() {
    return this.client.configured;
  }

  get automaticApprovalReady() {
    return this.approval?.enabled === true;
  }

  async provisionVirtualAccount(
    input: ProvisionVirtualAccountInput,
  ): Promise<ProviderVirtualAccount> {
    if (!this.client.configured)
      throw new ServiceUnavailableException('Paystack is not configured');
    if (input.currency !== 'NGN' || input.country !== 'NG')
      throw new BadRequestException(
        'Paystack banking currently supports Nigeria and NGN only',
      );
    const binding = await this.prisma.paystackCustomer.findUnique({
      where: { userId: input.userId },
    });
    if (binding?.validationStatus !== 'VERIFIED')
      throw new ForbiddenException(
        'Complete Paystack BVN and bank-account verification first',
      );
    if (!binding.accountSetupConsentAt)
      throw new ForbiddenException(
        'Consent is required to prepare your Paystack account',
      );
    const request = await this.prisma.paystackAccountRequest.upsert({
      where: { userId: input.userId },
      update: { customerCode: binding.customerCode },
      create: {
        userId: input.userId,
        customerCode: binding.customerCode,
        consentRecordedAt: binding.accountSetupConsentAt,
      },
    });
    const now = new Date();
    const claimed = await this.prisma.paystackAccountRequest.updateMany({
      where: {
        id: request.id,
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: new Date(now.getTime() - 120000) } },
        ],
      },
      data: { claimedAt: now, attempts: { increment: 1 }, status: 'PENDING' },
    });
    if (claimed.count !== 1)
      throw new ServiceUnavailableException(
        'Your account is being prepared. Refresh its status shortly.',
      );
    try {
      // Requery before create recovers a lost response without assigning another account.
      const customer = await this.client.request<Data>(
        'GET',
        `/customer/${binding.customerCode}`,
      );
      let account = customer.dedicated_account as Data | null;
      if (account == null) {
        const providers = await this.client.request<
          Array<{ provider_slug?: string; bank_slug?: string; slug?: string }>
        >('GET', '/dedicated_account/available_providers');
        const configured = this.config
          .get<string>('PAYSTACK_DVA_PREFERRED_BANK')
          ?.trim();
        const testMode = this.config
          .get<string>('PAYSTACK_SECRET_KEY')
          ?.startsWith('sk_test_');
        const preferred =
          configured ||
          (testMode
            ? 'test-bank'
            : providers[0]?.provider_slug ||
              providers[0]?.bank_slug ||
              providers[0]?.slug);
        if (
          !preferred ||
          (!testMode &&
            !providers.some(
              (bank) =>
                (bank.provider_slug || bank.bank_slug || bank.slug) ===
                preferred,
            ))
        )
          throw new BadRequestException(
            'Receiving accounts are unavailable right now. Please try again later or contact support.',
          );
        account = await this.client.request<Data>(
          'POST',
          '/dedicated_account',
          { customer: binding.customerCode, preferred_bank: preferred },
        );
      }
      const bank = (account.bank ?? {}) as Data;
      if (
        !/^\d{10}$/.test(providerText(account.account_number)) ||
        typeof account.account_name !== 'string' ||
        account.currency !== 'NGN' ||
        account.active !== true ||
        account.assigned !== true ||
        typeof bank.name !== 'string'
      )
        throw new ServiceUnavailableException(
          'Your Paystack account is not active yet',
        );
      // BankingService persists the usable account before marking the request ACTIVE.
      return {
        provider: 'paystack',
        providerAccountId: providerText(account.id),
        providerCustomerId: binding.customerCode,
        accountNumber: providerText(account.account_number),
        accountName: account.account_name,
        bankName: bank.name,
        bankCode: typeof bank.code === 'string' ? bank.code : undefined,
        currency: 'NGN',
        status: 'ACTIVE',
      };
    } catch (error) {
      await this.prisma.paystackAccountRequest.update({
        where: { id: request.id },
        data: {
          claimedAt: null,
          status:
            error instanceof BadRequestException
              ? 'ACTION_REQUIRED'
              : 'PENDING',
          lastError:
            error instanceof BadRequestException
              ? 'We couldn’t finish creating your receiving account. Please try again. If this continues, contact support.'
              : 'Your receiving account is being prepared. We’ll keep checking for your account details.',
          nextAttemptAt:
            error instanceof BadRequestException
              ? null
              : new Date(Date.now() + 300000),
        },
      });
      throw error;
    }
  }

  async listBanks(): Promise<
    Array<{ name: string; code: string; slug: string }>
  > {
    type Bank = { name: string; code: string; slug: string; active?: boolean };
    const banks: Bank[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.client.page<Bank>('/bank', {
        country: 'nigeria',
        currency: 'NGN',
        perPage: '100',
        use_cursor: 'true',
        ...(cursor ? { next: cursor } : {}),
      });
      banks.push(...page.data);
      const next = page.meta?.next;
      if (!next || next === 'null') break;
      if (seen.has(next) || seen.size >= 20)
        throw new ServiceUnavailableException(
          'Bank list could not be completely loaded',
        );
      seen.add(next);
      cursor = next;
    } while (cursor);
    return [
      ...new Map(
        banks
          .filter((bank) => bank.active !== false && bank.name && bank.code)
          .map(({ name, code, slug }) => [code, { name, code, slug }]),
      ).values(),
    ];
  }

  async resolveBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ accountName: string; bankCode: string; bankName?: string }> {
    const data = await this.client.request<{
      account_name: string;
      account_number: string;
    }>('GET', '/bank/resolve', undefined, {
      account_number: accountNumber,
      bank_code: bankCode,
    });
    if (!data.account_name || data.account_number !== accountNumber)
      throw new BadRequestException('Bank account could not be verified');
    return { accountName: data.account_name, bankCode };
  }

  async initiateTransfer(input: TransferInput) {
    const amount = toMinorUnit(new Decimal(input.amount));
    if (!/^[a-z0-9_-]{16,50}$/.test(input.reference))
      throw new BadRequestException('Invalid transfer reference');
    if (!this.approval?.enabled)
      throw new BadRequestException(
        'Bank transfer server approval is not ready',
      );
    let payload: {
      source: string;
      amount: number;
      reference: string;
      recipient: string;
      reason: string;
      currency: string;
    };
    try {
      const recipient = await this.client.request<{ recipient_code: string }>(
        'POST',
        '/transferrecipient',
        {
          type: 'nuban',
          name: input.accountName,
          account_number: input.accountNumber,
          bank_code: input.bankCode,
          currency: 'NGN',
        },
      );
      if (!recipient.recipient_code)
        throw new ServiceUnavailableException(
          'Transfer recipient could not be confirmed',
        );
      payload = {
        source: 'balance',
        amount,
        reference: input.reference,
        recipient: recipient.recipient_code,
        reason: input.narration || 'TRUSTPAY withdrawal',
        currency: 'NGN',
      };
      await this.approval.prepare(payload);
    } catch {
      // No transfer POST has been attempted: releasing the local reservation is
      // safe. Errors after the dispatch below remain ambiguous and reserved.
      throw new BadRequestException(
        'Bank transfer could not be prepared. Please try again.',
      );
    }
    let raw: Data;
    try {
      raw = await this.client.request<Data>('POST', '/transfer', payload);
    } catch (error) {
      // Even a 409/4xx can follow an accepted request (duplicate reference).
      // Never let the caller classify a dispatched HTTP error as unsent and
      // return the customer's funds while the external payout may proceed.
      if (error instanceof BadRequestException)
        throw new ServiceUnavailableException(
          'Transfer confirmation is pending. Check its status before trying again.',
        );
      throw error;
    }
    return {
      reference: input.reference,
      transactionReference: input.reference,
      status: providerText(raw.status, 'pending'),
      raw,
    };
  }

  authorizeTransfer(input: {
    reference: string;
    authorizationCode: string;
  }): Promise<{
    reference: string;
    transactionReference?: string;
    status: string;
    raw: Data;
    responseMessage?: string;
  }> {
    void input;
    return Promise.reject(
      new ForbiddenException(
        'Paystack approval belongs to the merchant. Contact support for a pending transfer.',
      ),
    );
  }
  resendTransferOtp(reference: string): Promise<{
    reference: string;
    raw: Data;
    responseMessage?: string;
    emailRecipients?: string[];
  }> {
    void reference;
    return Promise.reject(
      new ForbiddenException(
        'Paystack approval belongs to the merchant. Contact support for a pending transfer.',
      ),
    );
  }
  async getTransferStatus(reference: string): Promise<{
    reference: string;
    status: string;
    responseMessage?: string;
    raw: Data;
  }> {
    // Caller stores the merchant reference rather than substituting a transfer code.
    const raw = await this.client.request<Data>(
      'GET',
      `/transfer/verify/${encodeURIComponent(reference)}`,
    );
    return {
      reference: providerText(raw.reference, reference),
      status: providerText(raw.status, 'pending'),
      raw,
    };
  }
}
