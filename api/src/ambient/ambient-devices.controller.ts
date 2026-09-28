import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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

  @Post(':id/test-buzzer')
  testBuzzer(@Param('id') id: string) {
    return this.ambientService.queueTestBuzzer(id);
  }
}
