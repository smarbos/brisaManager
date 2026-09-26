import { IsInt, IsString, MinLength } from 'class-validator';

// One sensor's current reading, as reported in a heartbeat's `readings` array (and derived
// from a single alert's own sensor+level - see AmbientService.recordAlert).
export class AmbientReadingDto {
  @IsString()
  @MinLength(1)
  sensor: string;

  @IsInt()
  level: number;
}
