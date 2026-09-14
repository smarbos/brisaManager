import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignTemplateDto } from './dto/create-campaign-template.dto';
import { UpdateCampaignTemplateDto } from './dto/update-campaign-template.dto';

@Injectable()
export class CampaignTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCampaignTemplateDto) {
    return this.prisma.campaignTemplate.create({ data: dto });
  }

  findAll() {
    return this.prisma.campaignTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const template = await this.prisma.campaignTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return template;
  }

  async update(id: string, dto: UpdateCampaignTemplateDto) {
    await this.findOne(id);
    return this.prisma.campaignTemplate.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const usageCount = await this.prisma.campaign.count({ where: { templateId: id } });
    if (usageCount > 0) {
      throw new BadRequestException(
        `This template has been used in ${usageCount} campaign(s) and cannot be deleted.`,
      );
    }
    await this.prisma.campaignTemplate.delete({ where: { id } });
  }
}
