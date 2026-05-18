import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Security headers (XSS, clickjacking, MIME sniffing, etc.)
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // strip unknown properties
      forbidNonWhitelisted: true, // reject requests with unknown properties
      transform: true,
    }),
  );

  // CORS origin is env-configurable; falls back to localhost for local dev
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({ origin: allowedOrigin });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`ReadyOn Time-Off API listening on http://localhost:${port}`);
}

bootstrap();
