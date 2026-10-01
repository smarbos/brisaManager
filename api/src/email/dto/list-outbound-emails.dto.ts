import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { OutboundEmailStatus } from '@prisma/client';

export class ListOutboundEmailsDto {
  @IsOptional()
  @IsIn(Object.values(OutboundEmailStatus))
  status?: OutboundEmailStatus;

  @IsOptional()
  @IsString()
  reservationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
