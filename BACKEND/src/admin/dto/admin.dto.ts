import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  IsBoolean,
  IsInt,
  MaxLength,
  Max,
  MinLength,
  Min,
  Matches,
} from "class-validator";
import { Transform } from "class-transformer";
import { UserRole, KYCStatus } from "@prisma/client";
import {
  LimitQueryDto,
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
  PaginationQueryDto,
} from "../../common/dto/query.dto";

export class AdminUsersQueryDto extends PaginationQueryDto {
  @IsIn(["USER", "ADMIN"])
  @IsOptional()
  role?: UserRole;

  @IsIn(["PENDING", "SUBMITTED", "VERIFIED", "REJECTED"])
  @IsOptional()
  kycStatus?: KYCStatus;
}

export class AdminProviderEventsQueryDto extends LimitQueryDto {
  @IsIn(["RECEIVED", "PROCESSING", "PROCESSED", "FAILED", "IGNORED"])
  @IsOptional()
  status?: string;
}

export class AdminTransactionStatusDto {
  @IsIn(["PENDING", "SUCCESS", "FAILED", "REVERSED"])
  status: "PENDING" | "SUCCESS" | "FAILED" | "REVERSED";
}

export class AdminUpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsIn(["USER", "ADMIN"])
  @IsOptional()
  role?: UserRole;

  @IsIn(["PENDING", "SUBMITTED", "VERIFIED", "REJECTED"])
  @IsOptional()
  kycStatus?: KYCStatus;

  @IsBoolean()
  @IsOptional()
  isSuspended?: boolean;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class AdminStatsDto {
  totalUsers: number;
  totalTransactions: number;
  totalVolume: number;
  totalFees: number;
  activeUsers: number;
}

export class AdminActionReasonDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class AdminTransferVerificationDto extends AdminActionReasonDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  providerReference?: string;
}

export class AdminVtuStaleOrdersQueryDto extends LimitQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 10))
  @IsInt()
  @Min(1)
  @Max(1440)
  olderThanMinutes = 10;
}

export class AdminVtuReconciliationQueryDto extends LimitQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 10))
  @IsInt()
  @Min(1)
  @Max(1440)
  olderThanMinutes = 10;
}

const ADMIN_VTU_SERVICE_TYPES = [
  "AIRTIME",
  "DATA",
  "CABLE",
  "ELECTRICITY",
] as const;
const ADMIN_VTU_SCOPES = ["LOCAL", "INTERNATIONAL"] as const;
const ADMIN_VTU_PROVIDER_PATTERN = /^[A-Za-z0-9_-]{2,50}$/;
const ADMIN_MARGIN_PATTERN = /^(?:0|0\.\d{1,4}|[1-9]\d{0,9}(?:\.\d{1,4})?)$/;
const ADMIN_FIXED_MARGIN_PATTERN =
  /^(?:0|0\.\d{1,2}|[1-9]\d{0,9}(?:\.\d{1,2})?)$/;

function normalizeOptionalDecimalInput(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalized = normalizeDecimalInput(value);
  return typeof normalized === "string" ? normalized : String(normalized);
}

function normalizeOptionalIntegerInput(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}

export class AdminVtuPricingRulesQueryDto extends LimitQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, {
    message: "countryCode must be a valid ISO 3166-1 alpha-2 code",
  })
  countryCode?: string;

  @IsIn(ADMIN_VTU_SERVICE_TYPES)
  @IsOptional()
  serviceType?: (typeof ADMIN_VTU_SERVICE_TYPES)[number];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsString()
  @IsOptional()
  @Matches(ADMIN_VTU_PROVIDER_PATTERN, {
    message: "provider must contain only letters, numbers, underscore, or dash",
  })
  provider?: string;

  @IsIn(ADMIN_VTU_SCOPES)
  @IsOptional()
  scope?: (typeof ADMIN_VTU_SCOPES)[number];

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  isActive?: boolean;
}

export class AdminCreateVtuPricingRuleDto extends AdminActionReasonDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, {
    message: "countryCode must be a valid ISO 3166-1 alpha-2 code",
  })
  countryCode?: string;

  @IsIn(ADMIN_VTU_SERVICE_TYPES)
  @IsOptional()
  serviceType?: (typeof ADMIN_VTU_SERVICE_TYPES)[number];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsString()
  @IsOptional()
  @Matches(ADMIN_VTU_PROVIDER_PATTERN, {
    message: "provider must contain only letters, numbers, underscore, or dash",
  })
  provider?: string;

  @IsIn(ADMIN_VTU_SCOPES)
  @IsOptional()
  scope?: (typeof ADMIN_VTU_SCOPES)[number];

  @Transform(({ value }) => normalizeDecimalInput(value ?? "0"))
  @IsString()
  @Matches(ADMIN_FIXED_MARGIN_PATTERN, {
    message:
      "fixedMargin must be a non-negative decimal with at most 2 decimal places",
  })
  @IsOptional()
  fixedMargin?: string;

  @Transform(({ value }) => normalizeDecimalInput(value ?? "0"))
  @IsString()
  @Matches(ADMIN_MARGIN_PATTERN, {
    message:
      "percentMargin must be a non-negative decimal with at most 4 decimal places",
  })
  @IsOptional()
  percentMargin?: string;

  @Transform(({ value }: { value: unknown }) =>
    normalizeOptionalDecimalInput(value),
  )
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message:
      "minAmount must be a positive decimal with at most 2 decimal places",
  })
  @IsOptional()
  minAmount?: string;

  @Transform(({ value }: { value: unknown }) =>
    normalizeOptionalDecimalInput(value),
  )
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message:
      "maxAmount must be a positive decimal with at most 2 decimal places",
  })
  @IsOptional()
  maxAmount?: string;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  priority?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class AdminUpdateVtuPricingRuleDto extends AdminActionReasonDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, {
    message: "countryCode must be a valid ISO 3166-1 alpha-2 code",
  })
  countryCode?: string;

  @IsIn(ADMIN_VTU_SERVICE_TYPES)
  @IsOptional()
  serviceType?: (typeof ADMIN_VTU_SERVICE_TYPES)[number];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsString()
  @IsOptional()
  @Matches(ADMIN_VTU_PROVIDER_PATTERN, {
    message: "provider must contain only letters, numbers, underscore, or dash",
  })
  provider?: string;

  @IsIn(ADMIN_VTU_SCOPES)
  @IsOptional()
  scope?: (typeof ADMIN_VTU_SCOPES)[number];

  @Transform(({ value }: { value: unknown }) =>
    normalizeOptionalDecimalInput(value),
  )
  @IsString()
  @Matches(ADMIN_FIXED_MARGIN_PATTERN, {
    message:
      "fixedMargin must be a non-negative decimal with at most 2 decimal places",
  })
  @IsOptional()
  fixedMargin?: string;

  @Transform(({ value }: { value: unknown }) =>
    normalizeOptionalDecimalInput(value),
  )
  @IsString()
  @Matches(ADMIN_MARGIN_PATTERN, {
    message:
      "percentMargin must be a non-negative decimal with at most 4 decimal places",
  })
  @IsOptional()
  percentMargin?: string;

  @Transform(({ value }: { value: unknown }) =>
    normalizeOptionalDecimalInput(value),
  )
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message:
      "minAmount must be a positive decimal with at most 2 decimal places",
  })
  @IsOptional()
  minAmount?: string;

  @Transform(({ value }: { value: unknown }) =>
    normalizeOptionalDecimalInput(value),
  )
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message:
      "maxAmount must be a positive decimal with at most 2 decimal places",
  })
  @IsOptional()
  maxAmount?: string;

  @Transform(({ value }: { value: unknown }) =>
    normalizeOptionalIntegerInput(value),
  )
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  priority?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
