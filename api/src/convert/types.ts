import type { ReplaySubject } from 'rxjs';
import type { ProgressUpdate, Stage } from './ytdlp-progress.parser';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ProgressSnapshot {
  stage: Stage;
  percent: number;
  eta?: string;
  speed?: string;
  size?: string;
}

export interface JobError {
  code: string;
  message: string;
}

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  url: string;
  title?: string;
  fileName?: string;
  progress: ProgressSnapshot;
  error?: JobError;
  createdAt: string;
  updatedAt: string;
}

export type JobEvent =
  | { type: 'state'; data: JobSnapshot }
  | { type: 'progress'; data: ProgressUpdate }
  | { type: 'done'; data: { downloadUrl: string; fileName: string; title?: string } }
  | { type: 'failed'; data: JobError };

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  title?: string;
  fileName?: string;
  filePath?: string;
  tempDir?: string;
  progress: ProgressSnapshot;
  error?: JobError;
  createdAt: Date;
  updatedAt: Date;
  events$: ReplaySubject<JobEvent>;
  expiryTimer?: NodeJS.Timeout;
}

export function jobToSnapshot(job: Job): JobSnapshot {
  return {
    id: job.id,
    status: job.status,
    url: job.url,
    ...(job.title !== undefined ? { title: job.title } : {}),
    ...(job.fileName !== undefined ? { fileName: job.fileName } : {}),
    progress: job.progress,
    ...(job.error !== undefined ? { error: job.error } : {}),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
