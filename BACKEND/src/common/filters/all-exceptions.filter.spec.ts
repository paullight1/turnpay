import { ConflictException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter registration conflicts', () => {
  it('preserves only the allowlisted registration conflict code and message', () => {
    const reply = jest.fn();
    const logger = { error: jest.fn() };
    const filter = new AllExceptionsFilter(
      { httpAdapter: { reply } } as any,
      logger as any,
    );
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          path: '/api/auth/register',
          method: 'POST',
          url: '/api/auth/register',
        }),
        getResponse: () => ({}),
      }),
    } as any;

    filter.catch(
      new ConflictException({
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'That phone number is already linked to a TrustPay account.',
        email: 'must-not-leak@example.com',
      }),
      host,
    );

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusCode: 409,
        message: {
          code: 'PHONE_ALREADY_REGISTERED',
          message: 'That phone number is already linked to a TrustPay account.',
        },
      }),
      409,
    );
    expect(reply.mock.calls[0][1].message.email).toBeUndefined();
  });
});
