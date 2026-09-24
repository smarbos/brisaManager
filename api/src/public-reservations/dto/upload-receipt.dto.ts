import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadReceiptDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
