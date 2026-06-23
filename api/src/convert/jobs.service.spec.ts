import { firstValueFrom, lastValueFrom, take, toArray } from 'rxjs';
import { JobNotFoundError } from '../common/errors/domain.errors';
import { TempDirService } from '../common/temp-dir.service';
import { JobsService } from './jobs.service';
import type { JobEvent } from './types';

function makeTempDirs(): jest.Mocked<TempDirService> {
  return {
    create: jest.fn().mockResolvedValue('/tmp/x'),
    cleanup: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<TempDirService>;
}

describe('JobsService', () => {
  let svc: JobsService;
  let tempDirs: jest.Mocked<TempDirService>;

  beforeEach(() => {
    tempDirs = makeTempDirs();
    svc = new JobsService(tempDirs);
  });

  it('creates a queued job and emits an initial state event', async () => {
    const job = svc.create('https://example.com/x');
    expect(job.status).toBe('queued');
    expect(job.progress).toEqual({ stage: 'unknown', percent: 0 });

    const event = await firstValueFrom(svc.observe(job.id));
    expect(event.type).toBe('state');
  });

  it('throws JobNotFoundError for unknown ids', () => {
    expect(() => svc.get('nope')).toThrow(JobNotFoundError);
  });

  it('transitions queued -> running -> done and completes the stream', async () => {
    const job = svc.create('https://example.com/x');
    const eventsP = lastValueFrom(svc.observe(job.id).pipe(toArray()));

    svc.markRunning(job.id);
    svc.setTitle(job.id, 'Rick Astley');
    svc.updateProgress(job.id, { stage: 'download', percent: 25 });
    svc.updateProgress(job.id, { stage: 'download', percent: 80, eta: '00:05' });
    svc.markDone(job.id, '/tmp/x/file.mp3', 'file.mp3');

    const events = await eventsP;
    const types = events.map((e) => e.type);
    expect(types).toEqual(['state', 'state', 'state', 'progress', 'progress', 'done']);

    const done = events.find((e) => e.type === 'done') as Extract<JobEvent, { type: 'done' }>;
    expect(done.data.fileName).toBe('file.mp3');
    expect(done.data.title).toBe('Rick Astley');
  });

  it('replays buffered events to a late subscriber', async () => {
    const job = svc.create('https://example.com/x');
    svc.updateProgress(job.id, { stage: 'download', percent: 50 });
    svc.markDone(job.id, '/tmp/x/file.mp3', 'file.mp3');

    const types = await firstValueFrom(svc.observe(job.id).pipe(take(4), toArray())).then((evs) =>
      evs.map((e) => e.type),
    );

    expect(types).toContain('done');
  });

  it('cleans up temp dir on delete', async () => {
    const job = svc.create('https://example.com/x');
    svc.attachTempDir(job.id, '/tmp/job-x');
    await svc.delete(job.id);
    expect(tempDirs.cleanup).toHaveBeenCalledWith('/tmp/job-x');
    expect(() => svc.get(job.id)).toThrow(JobNotFoundError);
  });

  it('markFailed records the error and completes the stream', async () => {
    const job = svc.create('https://example.com/x');
    const eventsP = lastValueFrom(svc.observe(job.id).pipe(toArray()));

    svc.markRunning(job.id);
    svc.markFailed(job.id, { code: 'YTDLP_FAILED', message: 'boom' });

    const events = await eventsP;
    expect(events.at(-1)).toEqual({
      type: 'failed',
      data: { code: 'YTDLP_FAILED', message: 'boom' },
    });
    expect(svc.snapshot(job.id).status).toBe('failed');
  });
});
