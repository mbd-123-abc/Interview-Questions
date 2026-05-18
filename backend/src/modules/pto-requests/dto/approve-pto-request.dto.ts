import { IsNotEmpty, IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';

export class ApprovePtoRequestDto {
  @IsNotEmpty()
  @IsString()
  readonly managerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly notes?: string;

  @IsOptional()
  @IsBoolean()
  readonly verifyHcmBalance?: boolean;
}
