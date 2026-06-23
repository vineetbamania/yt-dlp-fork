import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../config/env';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;

    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const provided = header.slice('Bearer '.length).trim();
    const expected = this.config.get('AUTH_TOKEN', { infer: true });

    if (!constantTimeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Still run a constant-time compare against an equal-length buffer to
    // avoid revealing length differences via timing.
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
