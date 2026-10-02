import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { IsValidPhoneNumber } from '../../common/is-valid-phone-number';
import type { GuestDocumentType } from '../../guest-documents/guest-documents';

export class ConfirmDatesDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsValidPhoneNumber('AR')
  phone: string;

  @IsEmail()
  email: string;

  // The document is required at check-in. Its format is validated by normalizeDocument in
  // PublicReservationsService, which returns the Spanish 400 message the form shows inline.
  @IsIn(['DNI', 'PASAPORTE'], { message: 'Elegí el tipo de documento.' })
  documentType: GuestDocumentType;

  // Required for PASAPORTE only; DNI is always AR.
  @IsOptional()
  @IsString()
  documentCountry?: string;

  @IsString()
  @MinLength(1, { message: 'Ingresá el número de documento.' })
  documentNumber: string;

  // The marketing opt-in checkbox — unchecked (false/absent) by default.
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
