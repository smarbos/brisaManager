import { IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

// Field names are snake_case to match exactly what the Chrome extension sends (see
// chrome-extension/README.md) — the extension scrapes Booking.com's/Airbnb's own host UI, an
// external contract we don't control, so this shape is kept literal rather than translated to
// this API's usual camelCase to avoid a silent mapping bug between the two codebases.
export class ImportReservationDto {
  @IsIn(['booking.com', 'airbnb'])
  source: 'booking.com' | 'airbnb';

  // Only meaningful for source: 'booking.com' (pinned against BOOKING_HOTEL_ID in the
  // service) — Airbnb's messages page has no equivalent concept in this flow.
  @IsOptional()
  @IsString()
  @MinLength(1)
  hotel_id?: string;

  // Booking.com's reservation id, or for Airbnb either the messages-thread id or the
  // reservation's confirmation code (see airbnb_reference) — the stable identifier used to
  // dedupe repeat imports via externalReference.
  @IsString()
  @MinLength(1)
  res_id: string;

  // Airbnb only: which page res_id came from. "thread" (the default, for backward
  // compatibility) is the messages thread reached from Airbnb's email; "confirmation_code" is
  // the reservation page (/hosting/stay/<code>) reached from Airbnb's own UI.
  @IsOptional()
  @IsIn(['thread', 'confirmation_code'])
  airbnb_reference?: 'thread' | 'confirmation_code';

  @IsOptional()
  @IsString()
  guest_name: string | null;

  // Validated as a real email shape (not just any string) since, unlike the other scraped
  // fields, this one can trigger an actual outbound email to the guest — see
  // ChannelImportService.import().
  @IsOptional()
  @IsEmail()
  guest_email: string | null;

  // Airbnb-only for now (Booking.com's extranet page doesn't expose it) — used to sync the
  // Guest record, same as guest_email.
  @IsOptional()
  @IsString()
  guest_phone?: string | null;

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
