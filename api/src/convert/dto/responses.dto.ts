import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const JobStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);
export const StageSchema = z.enum([
  'download',
  'extract_audio',
  'metadata',
  'video_convert',
  'unknown',
]);

export const ProgressSchema = z.object({
  stage: StageSchema,
  percent: z.number().min(0).max(100),
  eta: z.string().optional(),
  speed: z.string().optional(),
  size: z.string().optional(),
});

export const JobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const CreateConvertResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal('queued'),
  eventsUrl: z.string(),
  downloadUrl: z.string(),
});

export const JobSnapshotSchema = z.object({
  id: z.string().uuid(),
  status: JobStatusSchema,
  url: z.string(),
  title: z.string().optional(),
  fileName: z.string().optional(),
  progress: ProgressSchema,
  error: JobErrorSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApiErrorSchema = z.object({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
  path: z.string(),
  timestamp: z.string(),
  details: z.unknown().optional(),
});

export class CreateConvertResponseDto extends createZodDto(CreateConvertResponseSchema) {}
export class JobSnapshotDto extends createZodDto(JobSnapshotSchema) {}
export class ApiErrorDto extends createZodDto(ApiErrorSchema) {}
