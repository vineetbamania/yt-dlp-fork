import { Body, Controller, Get, HttpCode, Logger, Param, Post, Res, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { map, type Observable } from 'rxjs';
import type { Response } from 'express';
import { DomainError, JobNotReadyError, YtDlpFailedError } from '../common/errors/domain.errors';
import { TempDirService } from '../common/temp-dir.service';
import { CreateConvertDto } from './dto/create-convert.dto';
import { ApiErrorDto, CreateConvertResponseDto, JobSnapshotDto } from './dto/responses.dto';
import { SourceResolver } from './extractors/source-resolver';
import { JobsService } from './jobs.service';
import type { Job, JobSnapshot } from './types';
import { validateUrl } from './url-validator';

interface SseMessageEvent {
  type: string;
  data: unknown;
}

interface CreateConvertResponse {
  jobId: string;
  status: 'queued';
  eventsUrl: string;
  downloadUrl: string;
}

@ApiBearerAuth()
@ApiTags('convert')
@Controller()
export class ConvertController {
  private readonly logger = new Logger(ConvertController.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly resolver: SourceResolver,
    private readonly tempDirs: TempDirService,
  ) {}

  @Post('convert')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start a conversion. Returns a jobId immediately.' })
  @ApiResponse({ status: 202, type: CreateConvertResponseDto, description: 'Job queued' })
  @ApiResponse({ status: 400, type: ApiErrorDto, description: 'Invalid URL or body' })
  @ApiResponse({ status: 401, type: ApiErrorDto, description: 'Missing or invalid bearer token' })
  create(@Body() dto: CreateConvertDto): CreateConvertResponse {
    const url = validateUrl(dto.url);
    const job = this.jobs.create(url.href);

    void this.runJob(job).catch((err) => {
      const code = err instanceof DomainError ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Job ${job.id} failed: ${message}`);
      this.jobs.markFailed(job.id, { code, message });
    });

    return {
      jobId: job.id,
      status: 'queued',
      eventsUrl: `/jobs/${job.id}/events`,
      downloadUrl: `/jobs/${job.id}/download`,
    };
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Current snapshot of a job (polling fallback).' })
  @ApiResponse({ status: 200, type: JobSnapshotDto })
  @ApiResponse({ status: 404, type: ApiErrorDto, description: 'Unknown job id' })
  snapshot(@Param('id') id: string): JobSnapshot {
    return this.jobs.snapshot(id);
  }

  @Sse('jobs/:id/events')
  @ApiOperation({ summary: 'Server-Sent Events stream of job progress.' })
  events(@Param('id') id: string): Observable<SseMessageEvent> {
    // Throws JobNotFoundError -> 404 before opening the stream.
    this.jobs.get(id);
    return this.jobs.observe(id).pipe(
      map((event) => ({
        type: event.type,
        data: event.data,
      })),
    );
  }

  @Get('jobs/:id/download')
  @ApiOperation({ summary: 'Download the completed MP3. Cleans up after stream end.' })
  download(@Param('id') id: string, @Res() res: Response): void {
    const job = this.jobs.get(id);

    if (job.status === 'failed') {
      throw new YtDlpFailedError(job.error?.message ?? 'Conversion failed');
    }
    if (job.status !== 'done' || !job.filePath || !job.fileName) {
      throw new JobNotReadyError(id);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeForHeader(job.fileName)}"`,
    );

    const stream = createReadStream(job.filePath);
    stream.on('error', (err) => {
      this.logger.error(`Read stream error for job ${id}: ${err.message}`);
      if (!res.headersSent) res.status(500);
      res.end();
    });

    res.on('close', () => {
      stream.destroy();
      this.jobs
        .delete(id)
        .catch((err) =>
          this.logger.warn(`Cleanup after download failed for ${id}: ${stringifyError(err)}`),
        );
    });

    stream.pipe(res);
  }

  private async runJob(job: Job): Promise<void> {
    const tempDir = await this.tempDirs.create(`job-${job.id}`);
    this.jobs.attachTempDir(job.id, tempDir);
    this.jobs.markRunning(job.id);

    const extractor = this.resolver.resolve(job.url);
    const result = await extractor.run({
      url: job.url,
      outputDir: tempDir,
      format: 'mp3',
      playlist: false, // M0: single track (playlist support lands in a later milestone)
      onTitle: (title) => this.jobs.setTitle(job.id, title),
      onProgress: (update) => this.jobs.updateProgress(job.id, update),
    });

    // M0: single-track only. Playlists (result.tracks.length > 1) handled later.
    const track = result.tracks[0];
    if (!track) {
      throw new YtDlpFailedError('Extractor produced no output file');
    }
    const fileName = basename(track.filePath);
    this.jobs.markDone(job.id, track.filePath, fileName);
  }
}

function sanitizeForHeader(name: string): string {
  // --restrict-filenames already keeps it ASCII; this is belt-and-suspenders
  // against accidental control chars or quotes.
  return name.replace(/[\r\n"\\]/g, '_');
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
