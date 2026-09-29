import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  userId: string;
  email: string;
}

// Reads the { userId, email } object JwtStrategy.validate() returns, which Passport attaches
// to request.user once JwtAuthGuard has run — only usable on JWT-guarded routes.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
