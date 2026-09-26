import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

// Same shape as ApiKeyGuard (../auth/api-key.guard.ts), but its own env var: ambient-control
// devices and the Chrome extension are different machines with different exposure (one sits
// on the LAN, the other runs on a staff member's laptop), so their credentials can be
// rotated independently.
@Injectable()
export class AmbientApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

    const expected = process.env.AMBIENT_API_KEY;
    if (!expected) {
      throw new UnauthorizedException('AMBIENT_API_KEY is not configured on the server');
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
