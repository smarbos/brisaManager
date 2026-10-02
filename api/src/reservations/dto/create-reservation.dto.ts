import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsNotEmpty,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ReservationSource } from '@prisma/client';
import { IsValidPhoneNumber } from '../../common/is-valid-phone-number';
import type { GuestDocumentType } from '../../guest-documents/guest-documents';

export const GUEST_CONTACT_REQUIRED_MESSAGE = 'Cargá el email o el teléfono del huésped.';

// The admin form sends "" for a field left empty — that means "none", not an invalid value.
function emptyToNull({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

export class CreateReservationDto {
  @IsString()
  @MinLength(1)
  guestName: string;

  // Only for manual entry via admin-web's reservation form. The Chrome extension's import
  // path uses a separate DTO (ImportReservationDto) specifically so a badly-scraped phone
  // string from Booking.com/Airbnb never blocks an import — see ChannelImportService, which
  // best-effort normalizes that value instead of rejecting it.
  @Transform(emptyToNull)
  @IsOptional()
  @IsValidPhoneNumber('AR')
  guestPhone?: string | null;

  // A reservation needs at least one way to reach the guest: the email is required whenever
  // there's no phone. (On edit, UpdateReservationDto makes this optional, and
  // ReservationsService.update() checks the resulting reservation instead.)
  @Transform(emptyToNull)
  @ValidateIf((dto: CreateReservationDto) => !dto.guestPhone)
  @IsNotEmpty({ message: GUEST_CONTACT_REQUIRED_MESSAGE })
  @IsString()
  guestEmail?: string | null;

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

  // The guest's identity document — optional for staff (required only at guest check-in).
  // Validated by normalizeDocument in ReservationsService, the same rules as check-in. On
  // edit, an empty documentNumber clears the reservation's document.
  @Transform(emptyToNull)
  @IsOptional()
  @IsIn(['DNI', 'PASAPORTE'])
  documentType?: GuestDocumentType | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  documentCountry?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  documentNumber?: string | null;
}
