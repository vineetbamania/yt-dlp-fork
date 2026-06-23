import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BearerAuthGuard } from './bearer-auth.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: BearerAuthGuard,
    },
  ],
})
export class AuthModule {}
