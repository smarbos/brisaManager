import { Module } from '@nestjs/common';
import { CampaignTemplatesController } from './campaign-templates.controller';
import { CampaignTemplatesService } from './campaign-templates.service';

@Module({
  controllers: [CampaignTemplatesController],
  providers: [CampaignTemplatesService],
  exports: [CampaignTemplatesService],
})
export class CampaignTemplatesModule {}
