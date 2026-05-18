import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class HcmPtoRequestEventDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  readonly externalEventId!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  readonly hcmRequestId!: string;

  @IsNotEmpty()
  @IsString()
  readonly ptoRequestId!: string;

  @IsNotEmpty()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  readonly status!: 'PENDING' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly notes?: string;

  @IsNotEmpty()
  @IsDateString()
  readonly actionedAt!: string;
}
