import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class HcmBalanceUpdateDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  readonly externalEventId!: string;

  @IsNotEmpty()
  @IsString()
  readonly employeeId!: string;

  @IsNotEmpty()
  @IsString()
  readonly locationId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  readonly balanceMinutes!: number;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  readonly hcmBalanceVersion!: string;

  @IsNotEmpty()
  @IsDateString()
  readonly asOf!: string;
}
