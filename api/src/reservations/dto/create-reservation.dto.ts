import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { ReservationSource } from '@prisma/client';

export class CreateReservationDto {
  @IsString()
  @MinLength(1)
  guestName: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;

  @IsOptional()
  @IsString()
  guestEmail?: string;

  @IsDateString()
  checkIn: string;

  @IsDateString()
  checkOut: string;

  @IsInt()
  @IsPositive()
  paxCount: number;

  @IsEnum(ReservationSource)
  source: ReservationSource;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsString()
  @MinLength(3)
  currency: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
