import { PartialType } from '@nestjs/mapped-types';
import { CreateCampaignTemplateDto } from './create-campaign-template.dto';

export class UpdateCampaignTemplateDto extends PartialType(CreateCampaignTemplateDto) {}
