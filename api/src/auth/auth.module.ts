import { Module } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

// Throttles /auth/login only (the only route in this module): a single admin account with no
// lockout is otherwise open to unlimited password guessing. Per client IP — see the
// 'trust proxy' setting in main.ts, which is what makes req.ip the real client behind Traefik.
@Module({
  imports: [
    PassportModule,
    ThrottlerModule.forRoot([{ name: 'login', ttl: 15 * 60_000, limit: 10 }]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as JwtSignOptions['expiresIn'],
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
