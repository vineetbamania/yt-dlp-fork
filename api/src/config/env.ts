import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  AUTH_TOKEN: z
    .string()
    .min(32, 'AUTH_TOKEN must be at least 32 chars. Generate with: openssl rand -hex 32'),
  TMP_DIR: z.string().min(1).default('./tmp'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Target MP3 bitrate for transcoded sources (e.g. JioSaavn AAC -> MP3).
  // CBR is intentional for broad player compatibility.
  AUDIO_BITRATE: z
    .string()
    .regex(/^\d{2,3}k$/, "AUDIO_BITRATE must look like '192k'")
    .default('192k'),
  // YouTube/Spotify(-via-YouTube) get bot-challenged from datacenter IPs.
  // Supply a Netscape cookies.txt to authenticate yt-dlp. Two ways (pick one):
  //  - YTDLP_COOKIES_FILE: absolute path to the file (local / VM / mounted volume)
  //  - YTDLP_COOKIES_B64:  base64 of the file's contents (e.g. a Fly.io secret;
  //    written to disk at boot). Takes precedence over the file path if both set.
  YTDLP_COOKIES_FILE: z.string().optional(),
  YTDLP_COOKIES_B64: z.string().optional(),
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
