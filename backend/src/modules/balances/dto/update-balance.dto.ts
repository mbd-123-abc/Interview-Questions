import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateBalanceDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  readonly balanceMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  readonly pendingMinutes?: number;
}
