import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InternalTransferDto } from './internal-transfer.dto';

describe('InternalTransferDto note boundary', () => {
  it('accepts a ten-digit receiving account and rejects malformed account numbers', async () => {
    const base = {
      amount: '50.00',
      currency: 'NGN',
      recipientAccountNumber: '0123456789',
    };
    expect(
      await validate(plainToInstance(InternalTransferDto, base)),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(InternalTransferDto, {
          ...base,
          recipientAccountNumber: '123',
        }),
      ),
    ).not.toHaveLength(0);
  });
  const build = (note: string) =>
    plainToInstance(InternalTransferDto, {
      recipientEmail: 'recipient@example.com',
      amount: '100.00',
      currency: 'NGN',
      transactionPin: '1234',
      note,
    });

  it('accepts exactly 120 Unicode code points', async () => {
    await expect(validate(build('💚'.repeat(120)))).resolves.toHaveLength(0);
  });

  it('rejects 121 Unicode code points', async () => {
    const errors = await validate(build('💚'.repeat(121)));
    expect(errors.some((error) => error.property === 'note')).toBe(true);
  });
});
