import { IsString, MinLength } from 'class-validator';

export class UpdateSettingsDto {
  @IsString()
  @MinLength(1)
  houseRulesText: string;

  @IsString()
  @MinLength(1)
  paymentInstructions: string;
}
