import { IsString, MinLength } from 'class-validator';

export class CreateCampaignTemplateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  @MinLength(1)
  bodyHtml: string;
}
