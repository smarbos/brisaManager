import { IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

// Either a plain ARS amount ("210000") or a percentage of the total ("30%") — see
// api/src/settings/fee-value.ts for how this is parsed and resolved.
const FEE_VALUE_PATTERN = /^\d+(\.\d+)?%?$/;

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

  // Optional, like the iCal URLs above: bank details may not be set up yet when Settings
  // is first created, and the guest-facing payment step simply shows blank fields rather
  // than a broken page until an admin fills these in.
  @IsOptional()
  @IsString()
  bankAccountHolder?: string;

  @IsOptional()
  @IsString()
  bankCuil?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  bankCbu?: string;

  @IsOptional()
  @IsString()
  bankAlias?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsString()
  @Matches(FEE_VALUE_PATTERN, { message: 'confirmationPaymentValue must be a plain amount (e.g. "210000") or a percentage (e.g. "30%")' })
  confirmationPaymentValue: string;

  @IsString()
  @Matches(FEE_VALUE_PATTERN, { message: 'securityDepositValue must be a plain amount (e.g. "150000") or a percentage (e.g. "15%")' })
  securityDepositValue: string;

  @IsString()
  @MinLength(1)
  confirmationStepText: string;
}
