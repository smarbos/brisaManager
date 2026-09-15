import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

// Separate from JwtAuthGuard: this protects endpoints called by machines that hold a
// long-lived shared secret (e.g. the Chrome extension, configured once in its options page)
// rather than a human who logged in and holds a short-lived session JWT.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

    const expected = process.env.EXTENSION_API_KEY;
    if (!expected) {
      throw new UnauthorizedException('EXTENSION_API_KEY is not configured on the server');
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
