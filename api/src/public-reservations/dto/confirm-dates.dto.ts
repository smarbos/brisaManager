import { IsEmail, IsString, MinLength } from 'class-validator';
import { IsValidPhoneNumber } from '../../common/is-valid-phone-number';

export class ConfirmDatesDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsValidPhoneNumber('AR')
  phone: string;

  @IsEmail()
  email: string;
}
