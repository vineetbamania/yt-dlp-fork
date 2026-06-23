import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { patchNestJsSwagger, ZodValidationPipe } from 'nestjs-zod';
import type { Server } from 'node:http';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLogger));
  app.use(helmet());
  app.enableShutdownHooks();
  app.useGlobalPipes(new ZodValidationPipe());

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  // Same-origin only; the static web/ is served by this same process.
  app.enableCors({ origin: false });

  // Swagger UI registers raw express routes that bypass APP_GUARD, so only
  // mount it outside production. In dev you'll hit /docs on localhost.
  if (nodeEnv !== 'production') {
    patchNestJsSwagger();
    const swaggerConfig = new DocumentBuilder()
      .setTitle('yt-dlp-fork')
      .setDescription('Personal YouTube/media -> MP3 API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // Long-running SSE + downloads: don't cut connections short.
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.requestTimeout = 0;

  await app.listen(port);
  app.get(PinoLogger).log(`API listening on http://localhost:${port}`);
}

void bootstrap();
