import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExtensionErrorsService } from './extension-errors.service';

@UseGuards(JwtAuthGuard)
@Controller('extension-errors')
export class ExtensionErrorsController {
  constructor(private readonly extensionErrorsService: ExtensionErrorsService) {}

  @Get()
  listAll() {
    return this.extensionErrorsService.listAll();
  }
}
