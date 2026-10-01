import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: the Resend webhook (ResendWebhooksController) verifies its signature against the
  // exact bytes received, which the parsed JSON body can't reproduce.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // In production every request arrives through exactly one proxy hop (Traefik, see
  // docker-compose.prod.yml). Without this, req.ip is Traefik's container IP for every
  // client, so every ThrottlerGuard in the app would bucket all clients together — one
  // attacker hitting the login limit would lock out the real admin too.
  app.set('trust proxy', 1);

  // crossOriginResourcePolicy is relaxed to same-site (helmet defaults to same-origin):
  // guest-web renders receipt images with a plain <img src> pointing at this API, which is a
  // different origin (api. vs reservas.labrisa.com.ar) but the same site.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

  app.enableCors({
    origin: [process.env.ADMIN_WEB_ORIGIN, process.env.GUEST_WEB_ORIGIN].filter(
      (origin): origin is string => Boolean(origin),
    ),
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.API_PORT ?? 3000);
}
bootstrap();
