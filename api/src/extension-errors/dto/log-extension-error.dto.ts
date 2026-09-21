import { IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

// Sent by background.js (chrome-extension) whenever it fails to check or submit a
// reservation — best-effort from the extension's side, so every field it can't be sure of is
// optional rather than required.
export class LogExtensionErrorDto {
  @IsIn(['booking.com', 'airbnb'])
  source: 'booking.com' | 'airbnb';

  @IsOptional()
  @IsString()
  resId?: string | null;

  // Which flow failed — not a fixed enum on this side since new operations may be added to
  // the extension without an API deploy; the admin UI just displays whatever string arrives.
  @IsString()
  @MinLength(1)
  operation: string;

  @IsString()
  @MinLength(1)
  message: string;

  @IsOptional()
  @IsString()
  detail?: string | null;

  @IsUrl({ require_tld: false })
  url: string;

  @IsOptional()
  @IsString()
  extensionVersion?: string | null;
}
