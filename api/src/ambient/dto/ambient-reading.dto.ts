import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

// One sensor's current reading, as reported in a heartbeat's `readings` array (and derived
// from a single alert's own sensor+level - see AmbientService.recordAlert).
export class AmbientReadingDto {
  @IsString()
  @MinLength(1)
  sensor: string;

  @IsInt()
  level: number;

  // The device's own calibrated alert threshold for this sensor, if it has one (sound, co,
  // smoke do; temperature/humidity don't) - lets the UI show the reading relative to what
  // actually triggers an alert on this specific device, not a bare uncalibrated number.
  @IsOptional()
  @IsInt()
  threshold?: number | null;
}
