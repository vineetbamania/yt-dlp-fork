import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { join } from 'node:path';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { ConvertModule } from './convert/convert.module';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      useFactory: () => {
        const isProd = process.env.NODE_ENV === 'production';
        return {
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? 'info',
            genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
            customLogLevel: (_req, res, err) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie'],
              censor: '[redacted]',
            },
            ...(isProd
              ? {}
              : {
                  transport: {
                    target: 'pino-pretty',
                    options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
                  },
                }),
          },
        };
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'web'),
      serveStaticOptions: { index: 'index.html', fallthrough: true },
    }),
    CommonModule,
    AuthModule,
    HealthModule,
    ConvertModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
