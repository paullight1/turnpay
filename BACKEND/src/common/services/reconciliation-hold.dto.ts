import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ClearReconciliationHoldDto {
  @IsUUID()
  passingRunId!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
