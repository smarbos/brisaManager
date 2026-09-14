import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GuestsService } from './guests.service';

@Controller('public/guests')
export class PublicGuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get(':token/unsubscribe')
  async unsubscribe(@Param('token') token: string, @Res() res: Response) {
    await this.guestsService.unsubscribeByToken(token);
    res.send(
      '<html><body><h1>Te diste de baja</h1><p>Ya no vas a recibir emails de marketing de La Brisa de Mar del Plata.</p></body></html>',
    );
  }
}
