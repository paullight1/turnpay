import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AttachManualProofDto,
  CreateManualExchangeDto,
  ReviewManualExchangeDto,
} from './manual-exchange.dto';

describe('manual exchange receipt validation', () => {
  it.each([
    {},
    { receiptName: '  Alex Morgan  ' },
    { bankReference: 'BANK-001' },
    { receiptName: 'Alex Morgan', bankReference: 'BANK-001' },
  ])(
    'accepts receipt details from current and legacy clients',
    async (details) => {
      const dto = plainToInstance(AttachManualProofDto, {
        objectKey: 'private/receipt.pdf',
        ...details,
      });
      expect(await validate(dto)).toEqual([]);
      if ('receiptName' in details) expect(dto.receiptName).toBe('Alex Morgan');
    },
  );

  it.each([{ receiptName: ' ' }, { receiptName: null }])(
    'rejects an invalid receipt name when supplied',
    async (details) => {
      const dto = plainToInstance(AttachManualProofDto, {
        objectKey: 'private/receipt.pdf',
        ...details,
      });
      expect((await validate(dto)).map((error) => error.property)).toContain(
        'receiptName',
      );
    },
  );
});

describe('manual payout handover request validation', () => {
  it('accepts large exact payout evidence up to the existing database precision', async () => {
    expect(
      await validate(
        plainToInstance(ReviewManualExchangeDto, {
          action: 'RECORD_PAYOUT_SENT',
          reason: 'Verified the completed external bank payment',
          payoutAmount: '1000000000000.00',
          payoutReference: 'SYNTHETIC-LARGE-PAYOUT',
          payoutProofObjectKey: 'synthetic/private-proof.pdf',
        }),
      ),
    ).toEqual([]);
  });
  it('validates the updated reverse-delivery contract marker without preventing old attempt recovery', async () => {
    const fields = {
      sourceCurrency: 'GHS',
      amount: '100.00',
      settlementMode: 'BANK',
      destinationInstitution: 'Synthetic Nigerian Bank',
      destinationAccount: '0123456789',
      destinationName: 'Beneficiary',
      transactionPin: '2468',
    };
    for (const deliveryPolicyVersion of [2, undefined]) {
      expect(
        await validate(
          plainToInstance(CreateManualExchangeDto, {
            ...fields,
            deliveryPolicyVersion,
          }),
        ),
      ).toEqual([]);
    }
    for (const deliveryPolicyVersion of ['2', 1, 3]) {
      const errors = await validate(
        plainToInstance(CreateManualExchangeDto, {
          ...fields,
          deliveryPolicyVersion,
        }),
      );
      expect(errors.map((error) => error.property)).toContain(
        'deliveryPolicyVersion',
      );
    }
  });
  it('requires an admin ID and an outcome when handing over', async () => {
    const errors = await validate(
      plainToInstance(ReviewManualExchangeDto, {
        action: 'HANDOVER_PAYOUT',
        reason: 'Checked original payout with the bank',
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['handoverToAdminId', 'payoutOutcome']),
    );
  });
  it('rejects malformed handover fields whenever supplied', async () => {
    const errors = await validate(
      plainToInstance(ReviewManualExchangeDto, {
        action: 'REQUEST_INFO',
        reason: 'Need the sender receipt details',
        handoverToAdminId: 123,
        payoutOutcome: 'invented-outcome',
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['handoverToAdminId', 'payoutOutcome']),
    );
  });
  it('accepts a complete typed handover request', async () => {
    expect(
      await validate(
        plainToInstance(ReviewManualExchangeDto, {
          action: 'HANDOVER_PAYOUT',
          reason: 'Checked original payout with the bank',
          handoverToAdminId: 'eaf2fa35-a51a-4086-af74-3a4cfbe0400d',
          payoutOutcome: 'NOT_SENT',
        }),
      ),
    ).toEqual([]);
  });
});
