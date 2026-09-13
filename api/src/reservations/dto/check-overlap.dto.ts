import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CheckOverlapDto {
  @IsDateString()
  checkIn: string;

  @IsDateString()
  checkOut: string;

  @IsOptional()
  @IsString()
  excludeId?: string;
}
