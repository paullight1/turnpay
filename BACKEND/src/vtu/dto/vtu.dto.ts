import {
  IsString,
  IsIn,
  IsOptional,
  IsNotEmpty,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { Transform } from "class-transformer";
import {
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
} from "../../common/dto/query.dto";

const VTU_TYPES = ["airtime", "data", "cable", "electricity"] as const;
const VTU_SCOPES = ["local", "international"] as const;
const VTU_PROVIDERS = [
  "mtn",
  "airtel",
  "glo",
  "9mobile",
  "dstv",
  "gotv",
  "startimes",
  "ikedc",
  "ekedc",
  "aedc",
  "ibedc",
  "phed",
  "jed",
  "kedco",
  "kaedco",
  "eedc",
  "bedc",
  "aba",
  "yedc",
] as const;
const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;
const CUSTOMER_IDENTIFIER_REGEX = /^[A-Za-z0-9-]{5,32}$/;

export class GetVtuProvidersDto {
  @IsString()
  @IsOptional()
  @IsIn(VTU_TYPES)
  type?: (typeof VTU_TYPES)[number];

  @IsString()
  @IsOptional()
  @IsIn(VTU_SCOPES)
  scope?: (typeof VTU_SCOPES)[number];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, {
    message: "countryCode must be a valid ISO 3166-1 alpha-2 code",
  })
  countryCode?: string;
}

export class AutoDetectReloadlyOperatorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  @Matches(PHONE_REGEX, {
    message: "phone must be a valid E.164 phone number",
  })
  phone: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{2}$/, {
    message: "countryCode must be a valid ISO 3166-1 alpha-2 code",
  })
  countryCode: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(["airtime", "data"])
  type: "airtime" | "data";
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
    message: "number must contain only letters, numbers, or hyphen",
  })
  number: string;
}

export class VtuOrderReferenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9:_-]{8,128}$/, {
    message: "reference must be a valid VTU order reference",
  })
  reference: string;
}

export class PurchaseVtuDto {
  @IsString()
  @IsOptional()
  @IsIn(VTU_SCOPES)
  scope?: (typeof VTU_SCOPES)[number];

  @IsString()
  @IsIn(VTU_TYPES)
  type: (typeof VTU_TYPES)[number];

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.scope !== "international")
  @IsNotEmpty()
  @IsIn(VTU_PROVIDERS)
  provider?: (typeof VTU_PROVIDERS)[number];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.scope === "international")
  @IsNotEmpty()
  @Matches(/^[A-Z]{2}$/, {
    message: "countryCode must be a valid ISO 3166-1 alpha-2 code",
  })
  countryCode?: string;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.scope === "international")
  @IsNotEmpty()
  @Matches(/^\d{1,12}$/, {
    message: "operatorId must be a valid Reloadly operator or biller id",
  })
  operatorId?: string;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => ["airtime", "data"].includes(dto.type))
  @IsNotEmpty()
  @MaxLength(15)
  @Matches(PHONE_REGEX, {
    message: "recipientNumber must be a valid E.164 phone number",
  })
  recipientNumber?: string;

  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: "amount must be a positive decimal with at most 2 decimal places",
  })
  amount: string;

  @IsString()
  @ValidateIf(
    (dto: PurchaseVtuDto) =>
      dto.type === "data" && dto.scope !== "international",
  )
  @IsNotEmpty()
  @MaxLength(100)
  packageId?: string;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.type === "cable")
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(CUSTOMER_IDENTIFIER_REGEX, {
    message: "smartCardNumber must contain only letters, numbers, or hyphen",
  })
  smartCardNumber?: string;

  @IsString()
  @ValidateIf((dto: PurchaseVtuDto) => dto.type === "electricity")
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\d{5,32}$/, {
    message: "meterNumber must contain 5 to 32 digits",
  })
  meterNumber?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4,6}$/)
  transactionPin?: string;
}
