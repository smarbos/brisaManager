import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PublicReservationsService } from './public-reservations.service';

// Every route under public/reservations/:token is gated only by that token. Checking it in a
// guard (rather than only inside each service method) matters for the upload route: guards
// run before interceptors, so an unknown or expired token is rejected before FilesInterceptor
// buffers up to MAX_FILES_PER_SUBMISSION × MAX_UPLOAD_BYTES into memory.
@Injectable()
export class PublicReservationTokenGuard implements CanActivate {
  constructor(private readonly service: PublicReservationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // Throws NotFoundException for an unknown or expired token.
    await this.service.findByToken(String(request.params.token));
    return true;
  }
}
