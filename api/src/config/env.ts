import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  AUTH_TOKEN: z
    .string()
    .min(32, 'AUTH_TOKEN must be at least 32 chars. Generate with: openssl rand -hex 32'),
  TMP_DIR: z.string().min(1).default('./tmp'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Optional TLS via tailscale-issued cert. If either is unset, the
  // server listens HTTP. main.ts reads these directly from process.env
  // so we don't need to thread them through ConfigService.
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  // Comma-separated origin allowlist for browser CORS. Empty disables
  // cross-origin requests entirely (same-origin still works). Used when
  // the frontend is served from a different origin (e.g. GitHub Pages).
  CORS_ORIGINS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
};
