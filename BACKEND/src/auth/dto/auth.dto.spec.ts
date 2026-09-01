import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EmailDto, PhoneDto, VerifyOtpDto } from './auth.dto';

async function validationMessages(input: object, dtoClass: new () => object) {
  const instance = plainToInstance(dtoClass, input);
  const errors = await validate(instance);

  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('Auth DTO validation', () => {
  it('accepts strict E.164 phone numbers and normalizes surrounding whitespace', async () => {
    const dto = plainToInstance(PhoneDto, {
      phone: '  +2348012345678  ',
    });
    const errors = await validate(dto);

    expect(errors).toEqual([]);
    expect(dto.phone).toBe('+2348012345678');
  });

  it('rejects phone numbers that are not strict E.164', async () => {
    await expect(
      validationMessages({ phone: '08012345678' }, PhoneDto),
    ).resolves.toContain('Phone number must be a valid E.164 phone number');
  });

  it('rejects OTP values that are not exactly six digits', async () => {
    await expect(
      validationMessages(
        { phone: '+2348012345678', otp: '12345a' },
        VerifyOtpDto,
      ),
    ).resolves.toContain('OTP must be exactly 6 digits');
  });

  it('normalizes email addresses before validation', async () => {
    const dto = plainToInstance(EmailDto, {
      email: '  Ada@Example.com  ',
    });
    const errors = await validate(dto);

    expect(errors).toEqual([]);
    expect(dto.email).toBe('ada@example.com');
  });
});
