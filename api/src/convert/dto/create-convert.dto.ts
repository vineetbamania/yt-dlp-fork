import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateConvertSchema = z
  .object({
    url: z.string().url().min(10).max(2048),
  })
  .strict();

export class CreateConvertDto extends createZodDto(CreateConvertSchema) {}
