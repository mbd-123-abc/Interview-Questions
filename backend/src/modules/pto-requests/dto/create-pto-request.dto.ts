import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePtoRequestDto {
  @IsNotEmpty()
  @IsString()
  readonly employeeId!: string;

  @IsNotEmpty()
  @IsString()
  readonly locationId!: string;

  @IsNotEmpty()
  @IsDateString()
  readonly startDate!: string;

  @IsNotEmpty()
  @IsDateString()
  readonly endDate!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  readonly requestedMinutes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly memo?: string;
}
