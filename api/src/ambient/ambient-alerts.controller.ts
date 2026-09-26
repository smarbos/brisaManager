import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AmbientService } from './ambient.service';

@UseGuards(JwtAuthGuard)
@Controller('ambient-alerts')
export class AmbientAlertsController {
  constructor(private readonly ambientService: AmbientService) {}

  @Get()
  listAll() {
    return this.ambientService.listAll();
  }
}
