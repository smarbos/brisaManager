import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsUUID, Min, ValidateIf } from 'class-validator';
import { CampaignFilterType } from '@prisma/client';

export class CampaignQueryDto {
  @IsUUID()
  templateId: string;

  @IsEnum(CampaignFilterType)
  filterType: CampaignFilterType;

  @ValidateIf((o) => o.filterType !== 'ALL')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  filterMonths?: number;
}
