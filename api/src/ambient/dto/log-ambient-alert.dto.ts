import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

// Sent by an ambient-control ESP32 device (see the brisa-ambient-control repo) when a
// sensor threshold rule fires — e.g. the sound sensor's repeated-loud-noise check.
export class LogAmbientAlertDto {
  @IsString()
  @MinLength(1)
  deviceId: string;

  // Free string, not a fixed enum on this side — new sensor types (smoke, temperature) can
  // ship on the firmware without an API deploy. The admin UI just displays whatever arrives.
  @IsString()
  @MinLength(1)
  sensor: string;

  @IsOptional()
  @IsInt()
  level?: number | null;

  // Same calibrated-threshold value described on AmbientReadingDto - included here too so an
  // alert updates the Sensors page's displayed threshold immediately, not just the next
  // heartbeat (up to 5 minutes later).
  @IsOptional()
  @IsInt()
  threshold?: number | null;

  // Technical detail from the firmware (e.g. "5 loud events within 30000ms") — the service
  // composes the human-facing, sensor-specific Spanish message around this, it isn't shown
  // to staff verbatim.
  @IsOptional()
  @IsString()
  detail?: string | null;
}
