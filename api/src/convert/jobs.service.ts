import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ReplaySubject, type Observable } from 'rxjs';
import { JobNotFoundError } from '../common/errors/domain.errors';
import { TempDirService } from '../common/temp-dir.service';
import type { ProgressUpdate } from './ytdlp-progress.parser';
import { jobToSnapshot, type Job, type JobError, type JobEvent, type JobSnapshot } from './types';

const EXPIRY_AFTER_DONE_MS = 10 * 60_000;
const EVENT_REPLAY_BUFFER = 50;

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly tempDirs: TempDirService) {}

  create(url: string): Job {
    const id = randomUUID();
    const now = new Date();
    const job: Job = {
      id,
      url,
      status: 'queued',
      progress: { stage: 'unknown', percent: 0 },
      createdAt: now,
      updatedAt: now,
      events$: new ReplaySubject<JobEvent>(EVENT_REPLAY_BUFFER),
    };
    this.jobs.set(id, job);
    this.emit(job, { type: 'state', data: jobToSnapshot(job) });
    return job;
  }

  get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new JobNotFoundError(id);
    return job;
  }

  observe(id: string): Observable<JobEvent> {
    return this.get(id).events$.asObservable();
  }

  attachTempDir(id: string, dir: string): void {
    const job = this.get(id);
    job.tempDir = dir;
  }

  markRunning(id: string): void {
    const job = this.get(id);
    job.status = 'running';
    this.touch(job);
    this.emit(job, { type: 'state', data: jobToSnapshot(job) });
  }

  setTitle(id: string, title: string): void {
    const job = this.get(id);
    job.title = title;
    this.touch(job);
    this.emit(job, { type: 'state', data: jobToSnapshot(job) });
  }

  updateProgress(id: string, update: ProgressUpdate): void {
    const job = this.get(id);
    job.progress = {
      stage: update.stage,
      percent: update.percent ?? job.progress.percent,
      ...(update.eta !== undefined ? { eta: update.eta } : {}),
      ...(update.speed !== undefined ? { speed: update.speed } : {}),
      ...(update.size !== undefined ? { size: update.size } : {}),
    };
    this.touch(job);
    this.emit(job, { type: 'progress', data: update });
  }

  markDone(id: string, filePath: string, fileName: string): void {
    const job = this.get(id);
    job.status = 'done';
    job.filePath = filePath;
    job.fileName = fileName;
    job.progress = { ...job.progress, percent: 100 };
    this.touch(job);
    this.emit(job, {
      type: 'done',
      data: {
        downloadUrl: `/jobs/${id}/download`,
        fileName,
        ...(job.title !== undefined ? { title: job.title } : {}),
      },
    });
    job.events$.complete();
    this.scheduleExpiry(id, EXPIRY_AFTER_DONE_MS);
  }

  markFailed(id: string, error: JobError): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    this.touch(job);
    this.emit(job, { type: 'failed', data: error });
    job.events$.complete();
    this.scheduleExpiry(id, EXPIRY_AFTER_DONE_MS);
  }

  snapshot(id: string): JobSnapshot {
    return jobToSnapshot(this.get(id));
  }

  async delete(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    if (job.tempDir) {
      try {
        await this.tempDirs.cleanup(job.tempDir);
      } catch (err) {
        this.logger.warn(`Failed to cleanup temp dir for job ${id}: ${stringifyError(err)}`);
      }
    }
    if (!job.events$.closed) job.events$.complete();
    this.jobs.delete(id);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.jobs.keys()].map((id) => this.delete(id)));
  }

  private touch(job: Job): void {
    job.updatedAt = new Date();
  }

  private emit(job: Job, event: JobEvent): void {
    if (!job.events$.closed) job.events$.next(event);
  }

  private scheduleExpiry(id: string, ms: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    job.expiryTimer = setTimeout(() => {
      this.delete(id).catch((err) =>
        this.logger.warn(`Expiry cleanup failed for ${id}: ${stringifyError(err)}`),
      );
    }, ms);
    job.expiryTimer.unref?.();
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
