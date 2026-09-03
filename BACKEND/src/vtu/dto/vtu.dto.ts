import {
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

export class GetVtuProvidersDto {
  @IsString()
  @IsOptional()
  @IsIn(VTU_TYPES)
  type?: (typeof VTU_TYPES)[number];
}

export class GetVtuPackagesDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(VTU_PROVIDERS)
  provider: (typeof VTU_PROVIDERS)[number];
}

export class ValidateVtuCustomerDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(VTU_PROVIDERS)
  provider: (typeof VTU_PROVIDERS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(CUSTOMER_IDENTIFIER_REGEX, {
    message: 'number must contain only letters, numbers, or hyphen',
  })
  number: string;
}

export class ValidateSmartCardDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['dstv', 'gotv', 'startimes'])
  provider: 'dstv' | 'gotv' | 'startimes';

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(CUSTOMER_IDENTIFIER_REGEX, {
    message: 'smartCardNumber must contain only letters, numbers, or hyphen',
  })
  smartCardNumber: string;

  @IsString()
  @IsIn(VTU_SUBSCRIPTION_TYPES)
  subscriptionType: VtuSubscriptionType;

  @PhoneField()
  @IsString()
  @Matches(NIGERIA_PHONE_REGEX, {
    message: 'contactPhone must be a valid Nigerian phone number',
  })
  contactPhone: string;
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
  provider: (typeof VTU_PROVIDERS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\d{5,32}$/, {
    message: 'meterNumber must contain 5 to 32 digits',
  })
  meterNumber: string;

  @IsString()
  @IsIn(VTU_METER_TYPES)
  meterType: VtuMeterType;

  @PhoneField()
  @IsString()
  @Matches(NIGERIA_PHONE_REGEX, {
    message: 'contactPhone must be a valid Nigerian phone number',
  })
  contactPhone: string;
}

export class VtuOrderReferenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9:_-]{8,128}$/, {
    message: 'reference must be a valid VTU order reference',
  })
  reference: string;
}

export class PurchaseVtuDto {
  @IsString()
  @IsIn(VTU_TYPES)
  type: VtuType;

  @IsString()
  @IsNotEmpty()
  @IsIn(VTU_PROVIDERS)
  provider: (typeof VTU_PROVIDERS)[number];

  @PhoneField()
  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => ['airtime', 'data'].includes(dto.type))
  @IsNotEmpty()
  @MaxLength(15)
  @Matches(NIGERIA_PHONE_REGEX, {
    message: 'recipientNumber must be a valid Nigerian phone number',
  })
  recipientNumber?: string;

  @PhoneField()
  @IsString()
  @Matches(NIGERIA_PHONE_REGEX, {
    message: 'contactPhone must be a valid Nigerian phone number',
  })
  contactPhone: string;

  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal with at most 2 decimal places',
  })
  amount: string;

  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      dto.type === 'data' ||
      (dto.type === 'cable' && dto.subscriptionType === 'change'),
  )
  @IsNotEmpty()
  @MaxLength(100)
  packageId?: string;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.type === 'cable')
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(CUSTOMER_IDENTIFIER_REGEX, {
    message: 'smartCardNumber must contain only letters, numbers, or hyphen',
  })
  smartCardNumber?: string;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.type === 'cable')
  @IsIn(VTU_SUBSCRIPTION_TYPES)
  subscriptionType?: VtuSubscriptionType;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.type === 'electricity')
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\d{5,32}$/, {
    message: 'meterNumber must contain 5 to 32 digits',
  })
  meterNumber?: string;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.type === 'electricity')
  @IsIn(VTU_METER_TYPES)
  meterType?: VtuMeterType;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4,6}$/)
  transactionPin?: string;
}
