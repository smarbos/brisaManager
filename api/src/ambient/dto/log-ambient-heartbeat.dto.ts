import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { AmbientReadingDto } from './ambient-reading.dto';

// Sent every HEARTBEAT_INTERVAL_MS (5 minutes - see config.h) by an ambient-control device,
// whether or not anything is currently alert-worthy - this is what lets the server notice a
// device that's gone silent (see AmbientOfflineSchedulerService), and keeps the Sensors page
// showing each sensor's latest reading even when nothing has crossed a threshold.
export class LogAmbientHeartbeatDto {
  @IsString()
  @MinLength(1)
  deviceId: string;

  // Only needs to be sent once in practice (the server remembers it), but cheap enough to
  // send every time so a renamed/reflashed device self-corrects without a manual DB edit.
  @IsOptional()
  @IsString()
  deviceName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmbientReadingDto)
  readings: AmbientReadingDto[];
}
