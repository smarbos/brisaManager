import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

// Sent by an ambient-control ESP32 device (see /ambient-control in the repo root) when a
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

  // Technical detail from the firmware (e.g. "5 loud events within 30000ms") — the service
  // composes the human-facing, sensor-specific Spanish message around this, it isn't shown
  // to staff verbatim.
  @IsOptional()
  @IsString()
  detail?: string | null;
}
