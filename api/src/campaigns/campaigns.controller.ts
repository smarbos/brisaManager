import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CampaignQueryDto } from './dto/campaign-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Get('preview')
  preview(@Query() query: CampaignQueryDto) {
    return this.service.preview(query.templateId, query.filterType, query.filterMonths);
  }

  @Post()
  send(@Body() dto: CampaignQueryDto) {
    return this.service.send(dto.templateId, dto.filterType, dto.filterMonths);
  }

  @Get()
  listHistory() {
    return this.service.listHistory();
  }
}
