import { IsEmail, IsString, MinLength } from 'class-validator';

export class ConfirmDatesDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsString()
  @MinLength(1)
  phone: string;

  @IsEmail()
  email: string;
}
