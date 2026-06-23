import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';
import { readFile } from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function loadHttpsOptions(): Promise<{ cert: Buffer; key: Buffer } | undefined> {
  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;
  if (!certPath || !keyPath) return undefined;
  const [cert, key] = await Promise.all([readFile(certPath), readFile(keyPath)]);
  return { cert, key };
}

async function bootstrap(): Promise<void> {
  const httpsOptions = await loadHttpsOptions();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    ...(httpsOptions ? { httpsOptions } : {}),
  });

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
  const server = app.getHttpServer() as HttpServer | HttpsServer;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.requestTimeout = 0;

  await app.listen(port);
  const scheme = httpsOptions ? 'https' : 'http';
  app.get(PinoLogger).log(`API listening on ${scheme}://localhost:${port}`);
}

void bootstrap();
