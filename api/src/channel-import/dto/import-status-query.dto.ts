import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

// Query params for the passive "is this already loaded?" check the extension runs on page
// load, before the operator has clicked anything — see ChannelImportController.status().
export class ImportStatusQueryDto {
  @IsIn(['booking.com', 'airbnb'])
  source: 'booking.com' | 'airbnb';

  @IsString()
  @MinLength(1)
  res_id: string;

  // Same meaning as ImportReservationDto.airbnb_reference.
  @IsOptional()
  @IsIn(['thread', 'confirmation_code'])
  airbnb_reference?: 'thread' | 'confirmation_code';
}
