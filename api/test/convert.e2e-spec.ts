import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { YtDlpService, type RunOptions, type RunResult } from '../src/convert/ytdlp.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

class FakeYtDlpService {
  async run(opts: RunOptions): Promise<RunResult> {
    const filePath = join(opts.outputDir, 'fake.mp3');
    await mkdir(opts.outputDir, { recursive: true });
    await writeFile(filePath, Buffer.from('ID3FAKE')); // tiny fake MP3
    opts.onTitle?.('Fake Title');
    opts.onProgress?.({ stage: 'download', percent: 50 });
    opts.onProgress?.({ stage: 'download', percent: 100 });
    opts.onProgress?.({ stage: 'extract_audio' });
    return { filePath, title: 'Fake Title' };
  }
}

const TOKEN = process.env.AUTH_TOKEN as string;

describe('Convert API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(YtDlpService)
      .useClass(FakeYtDlpService)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.useGlobalPipes(new ZodValidationPipe() as unknown as ValidationPipe);
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /convert', () => {
    it('rejects requests without a bearer token', async () => {
      await request(app.getHttpServer())
        .post('/convert')
        .send({ url: 'https://www.youtube.com/watch?v=x' })
        .expect(401)
        .expect((res) => {
          expect(res.body.code).toBe('UNAUTHORIZED');
        });
    });

    it('rejects malformed bodies', async () => {
      await request(app.getHttpServer())
        .post('/convert')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ url: 'not-a-url' })
        .expect(400);
    });

    it('rejects private hosts', async () => {
      await request(app.getHttpServer())
        .post('/convert')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ url: 'http://127.0.0.1/x' })
        .expect(400)
        .expect((res) => {
          expect(res.body.code).toBe('UNSUPPORTED_URL');
        });
    });

    it('returns 202 and a jobId for valid URLs', async () => {
      const res = await request(app.getHttpServer())
        .post('/convert')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
        .expect(202);

      expect(res.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.status).toBe('queued');
      expect(res.body.eventsUrl).toContain(res.body.jobId);
    });
  });

  describe('full conversion happy path', () => {
    it('runs through queued -> done and serves the file', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/convert')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
        .expect(202);

      const jobId = createRes.body.jobId as string;

      // Poll snapshot until done (the fake yt-dlp finishes immediately).
      let snapshot: { status: string; error?: { message: string } } | undefined;
      for (let i = 0; i < 40; i++) {
        const r = await request(app.getHttpServer())
          .get(`/jobs/${jobId}`)
          .set('Authorization', `Bearer ${TOKEN}`)
          .expect(200);
        snapshot = r.body;
        if (snapshot?.status === 'done' || snapshot?.status === 'failed') break;
        await new Promise((res) => setTimeout(res, 50));
      }

      expect(snapshot?.status).toBe('done');

      const download = await request(app.getHttpServer())
        .get(`/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      expect(download.headers['content-type']).toBe('audio/mpeg');
      expect(download.headers['content-disposition']).toContain('attachment');
      expect(download.body.toString('utf8').startsWith('ID3')).toBe(true);
    });
  });

  describe('GET /jobs/:id', () => {
    it('returns 404 for unknown ids', async () => {
      await request(app.getHttpServer())
        .get('/jobs/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(404)
        .expect((res) => {
          expect(res.body.code).toBe('JOB_NOT_FOUND');
        });
    });
  });

  describe('health probes', () => {
    it('/health requires bearer token', async () => {
      await request(app.getHttpServer()).get('/health').expect(401);
      await request(app.getHttpServer())
        .get('/health')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);
    });

    it('/healthz is public (for platform health checks)', async () => {
      await request(app.getHttpServer())
        .get('/healthz')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ status: 'ok' });
        });
    });
  });
});
