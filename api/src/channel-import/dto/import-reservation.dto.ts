import { IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

// Field names are snake_case to match exactly what the Chrome extension sends (see
// chrome-extension/README.md) — the extension scrapes Booking.com's extranet UI, an external
// contract we don't control, so this shape is kept literal rather than translated to this
// API's usual camelCase to avoid a silent mapping bug between the two codebases.
export class ImportReservationDto {
  @IsIn(['booking.com'])
  source: 'booking.com';

  @IsString()
  @MinLength(1)
  hotel_id: string;

  @IsString()
  @MinLength(1)
  res_id: string;

  @IsOptional()
  @IsString()
  guest_name: string | null;

  // Validated as a real email shape (not just any string) since, unlike the other scraped
  // fields, this one can trigger an actual outbound email to the guest — see
  // ChannelImportService.import().
  @IsOptional()
  @IsEmail()
  guest_email: string | null;

  @IsOptional()
  @IsISO8601()
  check_in: string | null;

  @IsOptional()
  @IsISO8601()
  check_out: string | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  guests: number | null;

  // Raw text as scraped (e.g. "$ 45.000"), not a parsed number — Booking.com's formatting is
  // unknown until Phase 2 selectors are confirmed, so cleanup happens in the service, not here.
  @IsOptional()
  @IsString()
  total_price: string | null;

  @IsOptional()
  @IsString()
  currency: string | null;

  @IsOptional()
  @IsString()
  status: string | null;

  @IsArray()
  @IsString({ each: true })
  unverified_fields: string[];
}
