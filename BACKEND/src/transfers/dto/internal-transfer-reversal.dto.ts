import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class InternalTransferReversalReasonDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class InternalTransferReferenceParamDto {
  @IsString()
  @MaxLength(128)
  @Matches(/^IT-[A-Za-z0-9-]+$/)
  reference: string;
}

export class InternalTransferReversalIdParamDto {
  @IsUUID()
  id: string;
}
