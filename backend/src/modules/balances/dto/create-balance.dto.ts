import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateBalanceDto {
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
}
