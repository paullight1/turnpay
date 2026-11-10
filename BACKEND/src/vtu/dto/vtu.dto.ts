import {
  IsEmail,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  IsString,
  IsIn,
  IsOptional,
  IsNotEmpty,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
} from '../../common/dto/query.dto';

export const VTU_TYPES = ['airtime', 'data', 'cable', 'electricity'] as const;
export const VTU_METER_TYPES = ['prepaid', 'postpaid'] as const;
export const VTU_SUBSCRIPTION_TYPES = ['change', 'renew'] as const;
export type VtuType = (typeof VTU_TYPES)[number];
export type VtuMeterType = (typeof VTU_METER_TYPES)[number];
export type VtuSubscriptionType = (typeof VTU_SUBSCRIPTION_TYPES)[number];
export const EXTENDED_VTU_PROVIDERS: ReadonlySet<string> = new Set([
  'smile-airtime',
  'smile',
  'glo-sme',
  '9mobile-sme',
  'showmax',
  'foreign-airtime',
]);
const VTU_PROVIDERS = [
  'mtn',
  'airtel',
  'glo',
  '9mobile',
  'dstv',
  'gotv',
  'startimes',
  'ikedc',
  'ekedc',
  'aedc',
  'ibedc',
  'phed',
  'jed',
  'kedco',
  'kaedco',
  'eedc',
  'bedc',
  'aba',
  'yedc',
  'smile-airtime',
  'smile',
  'glo-sme',
  '9mobile-sme',
  'showmax',
  'foreign-airtime',
] as const;
const NIGERIA_PHONE_REGEX = /^\+234[789]\d{9}$/;
const CUSTOMER_IDENTIFIER_REGEX = /^[A-Za-z0-9-]{5,32}$/;

export function normalizeNigeriaPhone(value: unknown) {
  if (typeof value !== 'string') return value;

  const phone = value.trim().replace(/[\s()-]/g, '');
  if (/^0[789]\d{9}$/.test(phone)) return `+234${phone.slice(1)}`;
  if (/^234[789]\d{9}$/.test(phone)) return `+${phone}`;
  return phone;
}

function PhoneField() {
  return Transform(({ value }) => normalizeNigeriaPhone(value));
}

export function isSmile(provider: string) {
  return provider === 'smile' || provider === 'smile-airtime';
}
export function needsPackage(dto: {
  type: string;
  provider: string;
  subscriptionType?: string;
}) {
  return (
    dto.type === 'data' ||
    isSmile(dto.provider) ||
    dto.provider === 'foreign-airtime' ||
    dto.provider === 'showmax' ||
    (dto.type === 'cable' && dto.subscriptionType === 'change')
  );
}
@ValidatorConstraint({ name: 'vtuRecipient', async: false })
class VtuRecipient implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const dto = args.object as PurchaseVtuDto;
    return (
      typeof value === 'string' &&
      (dto.provider === 'foreign-airtime'
        ? /^\+[1-9]\d{6,14}$/
        : NIGERIA_PHONE_REGEX
      ).test(value)
    );
  }
  defaultMessage() {
    return 'Enter a valid recipient phone number with country code';
  }
}

export class InternationalCountryDto {
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
}
export class ValidateSmileDto {
  @IsEmail() @MaxLength(254) smileEmail!: string;
}

export class GetVtuProvidersDto {
  @IsOptional() @IsIn(['extended']) catalog?: string;
  @IsString()
  @IsOptional()
  @IsIn(VTU_TYPES)
  type?: (typeof VTU_TYPES)[number];
}

export class GetVtuPackagesDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(VTU_PROVIDERS)
  provider!: (typeof VTU_PROVIDERS)[number];

  @ValidateIf(
    (dto: GetVtuPackagesDto) =>
      dto.provider === 'foreign-airtime' || dto.countryCode !== undefined,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
  @ValidateIf(
    (dto: GetVtuPackagesDto) =>
      dto.provider === 'foreign-airtime' || dto.operatorId !== undefined,
  )
  @IsString()
  @Matches(/^\d{1,12}$/)
  operatorId?: string;
}

export class ValidateVtuCustomerDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(VTU_PROVIDERS)
  provider!: (typeof VTU_PROVIDERS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(CUSTOMER_IDENTIFIER_REGEX, {
    message: 'number must contain only letters, numbers, or hyphen',
  })
  number!: string;
}

export class ValidateSmartCardDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['dstv', 'gotv', 'startimes'])
  provider!: 'dstv' | 'gotv' | 'startimes';

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(CUSTOMER_IDENTIFIER_REGEX, {
    message: 'smartCardNumber must contain only letters, numbers, or hyphen',
  })
  smartCardNumber!: string;

  @IsString()
  @IsIn(VTU_SUBSCRIPTION_TYPES)
  subscriptionType!: VtuSubscriptionType;

  @PhoneField()
  @IsString()
  @Matches(NIGERIA_PHONE_REGEX, {
    message: 'contactPhone must be a valid Nigerian phone number',
  })
  contactPhone!: string;
}

export class ValidateMeterDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([
    'ikedc',
    'ekedc',
    'aedc',
    'ibedc',
    'phed',
    'jed',
    'kedco',
    'kaedco',
    'eedc',
    'bedc',
    'aba',
    'yedc',
  ])
  provider!: (typeof VTU_PROVIDERS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\d{5,32}$/, {
    message: 'meterNumber must contain 5 to 32 digits',
  })
  meterNumber!: string;

  @IsString()
  @IsIn(VTU_METER_TYPES)
  meterType!: VtuMeterType;

  @PhoneField()
  @IsString()
  @Matches(NIGERIA_PHONE_REGEX, {
    message: 'contactPhone must be a valid Nigerian phone number',
  })
  contactPhone!: string;
}

export class VtuOrderReferenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9:_-]{8,128}$/, {
    message: 'reference must be a valid VTU order reference',
  })
  reference!: string;
}

export class PurchaseVtuDto {
  @IsString()
  @IsIn(VTU_TYPES)
  type!: VtuType;

  @IsString()
  @IsNotEmpty()
  @IsIn(VTU_PROVIDERS)
  provider!: (typeof VTU_PROVIDERS)[number];

  @PhoneField()
  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      dto.recipientNumber !== undefined ||
      (!isSmile(dto.provider) &&
        (['airtime', 'data'].includes(dto.type) || dto.provider === 'showmax')),
  )
  @IsNotEmpty()
  @MaxLength(16)
  @Validate(VtuRecipient)
  recipientNumber?: string;

  @PhoneField()
  @IsString()
  @Matches(NIGERIA_PHONE_REGEX, {
    message: 'contactPhone must be a valid Nigerian phone number',
  })
  contactPhone!: string;

  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal with at most 2 decimal places',
  })
  amount!: string;

  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) => needsPackage(dto) || dto.packageId !== undefined,
  )
  @IsNotEmpty()
  @MaxLength(100)
  packageId?: string;

  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      (dto.type === 'cable' && dto.provider !== 'showmax') ||
      dto.smartCardNumber !== undefined,
  )
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(CUSTOMER_IDENTIFIER_REGEX, {
    message: 'smartCardNumber must contain only letters, numbers, or hyphen',
  })
  smartCardNumber?: string;

  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      (dto.type === 'cable' && dto.provider !== 'showmax') ||
      dto.subscriptionType !== undefined,
  )
  @IsIn(VTU_SUBSCRIPTION_TYPES)
  subscriptionType?: VtuSubscriptionType;

  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      dto.type === 'electricity' || dto.meterNumber !== undefined,
  )
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\d{5,32}$/, {
    message: 'meterNumber must contain 5 to 32 digits',
  })
  meterNumber?: string;

  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      dto.type === 'electricity' || dto.meterType !== undefined,
  )
  @IsIn(VTU_METER_TYPES)
  meterType?: VtuMeterType;

  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      isSmile(dto.provider) || dto.smileEmail !== undefined,
  )
  @IsEmail()
  @MaxLength(254)
  smileEmail?: string;
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      isSmile(dto.provider) || dto.smileAccountId !== undefined,
  )
  @IsString()
  @Matches(/^\d{5,32}$/)
  smileAccountId?: string;
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      dto.provider === 'foreign-airtime' || dto.countryCode !== undefined,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      dto.provider === 'foreign-airtime' || dto.operatorId !== undefined,
  )
  @IsString()
  @Matches(/^\d{1,12}$/)
  operatorId?: string;
  @IsOptional()
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN)
  expectedTotal?: string;
  @IsOptional() @IsString() @Matches(MONEY_AMOUNT_PATTERN) faceValue?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4,6}$/)
  transactionPin?: string;
}

export class VtuQuoteDto extends GetVtuPackagesDto {
  @IsString() @IsNotEmpty() @MaxLength(100) packageId!: string;
  @IsOptional() @IsString() @Matches(MONEY_AMOUNT_PATTERN) faceValue?: string;
  @IsString() @IsIn(VTU_TYPES) type!: VtuType;
}
