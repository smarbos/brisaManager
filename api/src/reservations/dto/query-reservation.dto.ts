import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { ReservationSource, ReservationStatus } from '@prisma/client';

export class QueryReservationDto {
  @IsOptional()
  @IsEnum(ReservationSource)
  source?: ReservationSource;

  // One status (?status=PENDING) or several (?status=PENDING&status=CONFIRMED) — the admin
  // list's default "Pendientes y Aceptadas" view asks for two.
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsEnum(ReservationStatus, { each: true })
  status?: ReservationStatus[];
}
