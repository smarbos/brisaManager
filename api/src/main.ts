import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [process.env.ADMIN_WEB_ORIGIN, process.env.GUEST_WEB_ORIGIN].filter(Boolean),
  });
  await app.listen(process.env.API_PORT ?? 3000);
}
bootstrap();
