import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ChannelImportController } from './channel-import.controller';
import { ChannelImportService } from './channel-import.service';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { GuestsModule } from '../guests/guests.module';
import { ReservationsModule } from '../reservations/reservations.module';

// ThrottlerModule is imported here (not registered globally in AppModule) so the rate limit
// applies only to this machine-facing endpoint, not to every route in the app.
@Module({
  imports: [
    GoogleCalendarModule,
    GuestsModule,
    ReservationsModule,
    ThrottlerModule.forRoot([{ name: 'channel-import', ttl: 60_000, limit: 10 }]),
  ],
  controllers: [ChannelImportController],
  providers: [ChannelImportService],
})
export class ChannelImportModule {}
