import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignTemplatesService } from './campaign-templates.service';
import { CreateCampaignTemplateDto } from './dto/create-campaign-template.dto';
import { UpdateCampaignTemplateDto } from './dto/update-campaign-template.dto';

@UseGuards(JwtAuthGuard)
@Controller('campaign-templates')
export class CampaignTemplatesController {
  constructor(private readonly service: CampaignTemplatesService) {}

  @Post()
  create(@Body() dto: CreateCampaignTemplateDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
