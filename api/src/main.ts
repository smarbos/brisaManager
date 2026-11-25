import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: the Resend webhook (ResendWebhooksController) verifies its signature against the
  // exact bytes received, which the parsed JSON body can't reproduce.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // In production a request passes through two proxies: Cloudflare, then Traefik (see
  // docker-compose.prod.yml, which makes Traefik keep X-Forwarded-For only from Cloudflare's
  // ranges). Trusting both hops makes req.ip the visitor; with one, every visitor through
  // Cloudflare looked like a handful of Cloudflare IPs to the rate limits, so one attacker
  // hitting the login limit could lock out the real admin. A request that skips Cloudflare
  // carries only the address Traefik saw, so it's still counted by its real IP.
  app.set('trust proxy', 2);

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
