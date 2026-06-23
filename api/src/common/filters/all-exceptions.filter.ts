import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  path: string;
  timestamp: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const body = this.toBody(exception, req.url);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.url} -> ${body.statusCode} ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${req.method} ${req.url} -> ${body.statusCode} ${body.code}`);
    }

    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, path: string): ErrorBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        path,
        timestamp,
        details: exception.issues,
      };
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();
      if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>;
        return {
          statusCode: status,
          code: typeof r.code === 'string' ? r.code : this.defaultCode(status),
          message:
            typeof r.message === 'string'
              ? r.message
              : Array.isArray(r.message)
                ? r.message.join('; ')
                : exception.message,
          path,
          timestamp,
        };
      }
      return {
        statusCode: status,
        code: this.defaultCode(status),
        message: typeof response === 'string' ? response : exception.message,
        path,
        timestamp,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      path,
      timestamp,
    };
  }

  private defaultCode(status: number): string {
    switch (status) {
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 400:
        return 'BAD_REQUEST';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }
}
