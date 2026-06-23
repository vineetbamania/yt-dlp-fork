import { HttpException, HttpStatus } from '@nestjs/common';

export class DomainError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

export class UnsupportedUrlError extends DomainError {
  constructor(message = 'URL is not supported') {
    super('UNSUPPORTED_URL', message, HttpStatus.BAD_REQUEST);
  }
}

export class JobNotFoundError extends DomainError {
  constructor(jobId: string) {
    super('JOB_NOT_FOUND', `No job with id ${jobId}`, HttpStatus.NOT_FOUND);
  }
}

export class JobNotReadyError extends DomainError {
  constructor(jobId: string) {
    super('JOB_NOT_READY', `Job ${jobId} has not finished yet`, HttpStatus.CONFLICT);
  }
}

export class YtDlpFailedError extends DomainError {
  constructor(message: string) {
    super('YTDLP_FAILED', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
