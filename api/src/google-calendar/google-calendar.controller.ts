import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(private readonly authService: GoogleCalendarAuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('oauth/connect-url')
  getConnectUrl() {
    return { url: this.authService.getConsentUrl() };
  }

  @Get('oauth/callback')
  async callback(@Query('code') code: string | undefined, @Res() res: Response) {
    const adminOrigin = process.env.ADMIN_WEB_ORIGIN ?? '';
    if (!code) {
      res.redirect(`${adminOrigin}/settings?googleCalendar=error`);
      return;
    }
    try {
      await this.authService.handleOAuthCallback(code);
      res.redirect(`${adminOrigin}/settings?googleCalendar=connected`);
    } catch {
      res.redirect(`${adminOrigin}/settings?googleCalendar=error`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('disconnect')
  async disconnect() {
    await this.authService.disconnect();
    return { disconnected: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus() {
    return this.authService.getStatus();
  }
}
