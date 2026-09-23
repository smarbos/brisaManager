import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';
import { ReservationSource } from '@prisma/client';
import { IsValidPhoneNumber } from '../../common/is-valid-phone-number';

export class CreateReservationDto {
  @IsString()
  @MinLength(1)
  guestName: string;

  // Only for manual entry via admin-web's reservation form. The Chrome extension's import
  // path uses a separate DTO (ImportReservationDto) specifically so a badly-scraped phone
  // string from Booking.com/Airbnb never blocks an import — see ChannelImportService, which
  // best-effort normalizes that value instead of rejecting it.
  @IsOptional()
  @IsValidPhoneNumber('AR')
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
