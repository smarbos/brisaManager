import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { GoogleCalendarPullService } from './google-calendar-pull.service';

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly authService: GoogleCalendarAuthService,
    private readonly pullService: GoogleCalendarPullService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('oauth/connect-url')
  getConnectUrl() {
    return { url: this.authService.getConsentUrl() };
  }

  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const adminOrigin = process.env.ADMIN_WEB_ORIGIN ?? '';
    if (!code) {
      res.redirect(`${adminOrigin}/settings?googleCalendar=error`);
      return;
    }
    try {
      await this.authService.handleOAuthCallback(code, state ?? '');
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
  @Post('sync-now')
  async syncNow() {
    await this.pullService.pull();
    return { triggeredAt: new Date() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus() {
    return this.authService.getStatus();
  }
}
