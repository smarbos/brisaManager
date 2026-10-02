import { IsIn, IsOptional, IsString } from 'class-validator';
import type { GuestDocumentType } from '../../guest-documents/guest-documents';

// GET /guests?document=12345678&documentType=DNI — exact match by document. The API hashes the
// normalized document; the number itself is never stored or logged in plain form.
export class QueryGuestsDto {
  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsIn(['DNI', 'PASAPORTE'])
  documentType?: GuestDocumentType;

  @IsOptional()
  @IsString()
  documentCountry?: string;
}
