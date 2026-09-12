import { IsEnum, IsOptional } from 'class-validator';
import { ReservationSource, ReservationStatus } from '@prisma/client';

export class QueryReservationDto {
  @IsOptional()
  @IsEnum(ReservationSource)
  source?: ReservationSource;

  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}
