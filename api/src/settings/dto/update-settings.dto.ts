import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateSettingsDto {
  @IsString()
  @MinLength(1)
  houseRulesText: string;

  @IsString()
  @MinLength(1)
  paymentInstructions: string;

  @IsString()
  @MinLength(1)
  depositInstructions: string;

  @IsString()
  @MinLength(1)
  propertyAddress: string;

  // Optional: not every property has a Maps link set up yet, and the final confirmation
  // email simply omits it when empty rather than sending a broken/empty link.
  @IsString()
  googleMapsUrl: string;

  @IsString()
  @MinLength(1)
  initialEmailTemplate: string;

  @IsString()
  @MinLength(1)
  finalEmailTemplate: string;

  @IsString()
  @MinLength(1)
  cancellationEmailTemplate: string;

  @IsOptional()
  @IsString()
  bookingIcalUrl?: string;

  @IsOptional()
  @IsString()
  airbnbIcalUrl?: string;

  @IsInt()
  @Min(1)
  reservationReminderDaysBefore: number;

  @IsInt()
  @Min(1)
  depositReminderDaysAfter: number;

  @IsString()
  @MinLength(1)
  reservationReminderWhatsappTemplate: string;

  @IsString()
  @MinLength(1)
  depositReminderWhatsappTemplate: string;
}
