import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateDates(checkIn: string, checkOut: string) {
    if (new Date(checkOut) <= new Date(checkIn)) {
      throw new BadRequestException('checkOut must be after checkIn');
    }
  }

  async create(dto: CreateReservationDto) {
    this.validateDates(dto.checkIn, dto.checkOut);

    return this.prisma.reservation.create({
      data: {
        ...dto,
        checkIn: new Date(dto.checkIn),
        checkOut: new Date(dto.checkOut),
      },
    });
  }

  async findAll(query: QueryReservationDto) {
    return this.prisma.reservation.findMany({
      where: {
        source: query.source,
        status: query.status,
      },
      orderBy: { checkIn: 'desc' },
    });
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  async update(id: string, dto: UpdateReservationDto) {
    await this.findOne(id);

    if (dto.checkIn && dto.checkOut) {
      this.validateDates(dto.checkIn, dto.checkOut);
    }

    return this.prisma.reservation.update({
      where: { id },
      data: {
        ...dto,
        checkIn: dto.checkIn ? new Date(dto.checkIn) : undefined,
        checkOut: dto.checkOut ? new Date(dto.checkOut) : undefined,
      },
    });
  }
}
