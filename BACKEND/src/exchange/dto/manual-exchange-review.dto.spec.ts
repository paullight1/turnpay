import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReviewManualExchangeDto } from './manual-exchange.dto';

describe('manual payout handover request validation', () => {
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
