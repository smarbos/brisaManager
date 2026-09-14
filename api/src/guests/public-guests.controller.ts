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
      '<html><body><h1>You have been unsubscribed</h1><p>You will no longer receive marketing emails from La Brisa de Mar del Plata.</p></body></html>',
    );
  }
}
