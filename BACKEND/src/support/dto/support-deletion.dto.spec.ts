import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupportTicketDto } from './support.dto';

describe('account deletion support requests', () => {
  it('accepts a dedicated account deletion category', async () => {
    const dto = plainToInstance(CreateSupportTicketDto, {
      category: 'ACCOUNT_DELETION',
      description: 'Account deletion requested from mobile profile.',
    });
    expect(await validate(dto)).toEqual([]);
  });
});
