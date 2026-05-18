import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectPtoRequestDto {
  @IsNotEmpty()
  @IsString()
  readonly managerId!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  readonly reason!: string;
}
