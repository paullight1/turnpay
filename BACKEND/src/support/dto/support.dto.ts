import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

const SUPPORT_CATEGORIES = [
  "ACCOUNT",
  "KYC",
  "WALLET",
  "TRANSACTION",
  "WITHDRAWAL",
  "EXCHANGE",
  "VTU",
  "OTHER",
] as const;

const SUPPORT_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED",
  "CLOSED",
  "ESCALATED",
] as const;

export class CreateSupportTicketDto {
  @IsString()
  @IsIn(SUPPORT_CATEGORIES)
  category: (typeof SUPPORT_CATEGORIES)[number];

  @IsString()
  @IsOptional()
  @MaxLength(80)
  transactionId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  transactionReference?: string;

  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  description: string;
}

export class ResolveSupportTicketDto {
  @IsString()
  @IsIn(["RESOLVED", "CLOSED", "ESCALATED"])
  status: "RESOLVED" | "CLOSED" | "ESCALATED";

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  resolution?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export type SupportTicketStatus = (typeof SUPPORT_STATUSES)[number];

export function isSupportTicketStatus(
  status?: string,
): status is SupportTicketStatus {
  return SUPPORT_STATUSES.includes(status as SupportTicketStatus);
}
