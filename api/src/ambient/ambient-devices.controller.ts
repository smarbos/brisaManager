import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AmbientService } from './ambient.service';

@UseGuards(JwtAuthGuard)
@Controller('ambient-devices')
export class AmbientDevicesController {
  constructor(private readonly ambientService: AmbientService) {}

  @Get()
  listAll() {
    return this.ambientService.listDevices();
  }
}
