import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { ReservationStatus } from '@prisma/client';
import { CreateReservationDto } from './create-reservation.dto';

export class UpdateReservationDto extends PartialType(OmitType(CreateReservationDto, ['notifyGuest'] as const)) {
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}
