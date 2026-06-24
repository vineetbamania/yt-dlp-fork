import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { YtDlpFailedError } from '../common/errors/domain.errors';
import type { Env } from '../config/env';
import { parseLine, type ProgressUpdate } from './ytdlp-progress.parser';

export interface RunOptions {
  url: string;
  outputDir: string;
  onTitle?: (title: string) => void;
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  filePath: string;
  title?: string;
}

/**
 * Build the yt-dlp argv. yt-dlp does the MP3 conversion itself, so we make it
 * emit the final output directly (CBR + ID3v1/v2.3 for broad compatibility)
 * rather than re-encoding afterwards — same target as AudioNormalizer, but no
 * wasteful second pass.
 */
export function buildYtDlpArgs(
  options: RunOptions,
  audioQuality: string,
  cookiesPath?: string,
): string[] {
  return [
    '--no-playlist',
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--audio-quality',
    audioQuality, // e.g. "192K" -> CBR (a bare number would mean VBR quality)
    '--postprocessor-args',
    'ExtractAudio:-id3v2_version 3 -write_id3v1 1',
    // Authenticate against YouTube etc. when running from a datacenter IP.
    ...(cookiesPath ? ['--cookies', cookiesPath] : []),
    '--no-color',
    '--newline',
    '--restrict-filenames',
    '--print',
    'before_dl:[ytfork:title] %(title)s',
    '--print',
    'after_move:[ytfork:final] %(filepath)s',
    '-o',
    '%(id)s.%(ext)s',
    '--paths',
    options.outputDir,
    options.url,
  ];
}

/**
 * Resolve the yt-dlp cookies file path from config. If cookies are supplied as
 * base64 (e.g. a Fly.io secret), decode them to a file under TMP_DIR once at
 * startup; otherwise use the explicit file path. Returns undefined when neither
 * is set (no cookies — fine for JioSaavn/Gaana/SoundCloud).
 */
export function resolveCookiesPath(config: ConfigService<Env, true>): string | undefined {
  const b64 = config.get('YTDLP_COOKIES_B64', { infer: true });
  if (b64) {
    const dest = join(resolve(config.get('TMP_DIR', { infer: true })), 'yt-dlp-cookies.txt');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(b64, 'base64'), { mode: 0o600 });
    return dest;
  }
  return config.get('YTDLP_COOKIES_FILE', { infer: true });
}

@Injectable()
export class YtDlpService {
  private readonly logger = new Logger(YtDlpService.name);
  /** yt-dlp `--audio-quality` value (uppercased bitrate, e.g. "192K"). */
  private readonly audioQuality: string;
  /** Optional cookies.txt path for authenticated extraction (YouTube etc.). */
  private readonly cookiesPath: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.audioQuality = config.get('AUDIO_BITRATE', { infer: true }).toUpperCase();
    this.cookiesPath = resolveCookiesPath(config);
    if (this.cookiesPath) this.logger.log(`Using yt-dlp cookies: ${this.cookiesPath}`);
  }

  run(options: RunOptions): Promise<RunResult> {
    const args = buildYtDlpArgs(options, this.audioQuality, this.cookiesPath);

    this.logger.log(`spawning: yt-dlp <flags> ${options.url}`);

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn('yt-dlp', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options.signal ? { signal: options.signal } : {}),
      });

      let title: string | undefined;
      let finalPath: string | undefined;
      const stderrTail: string[] = [];

      const handleStdoutLine = (line: string): void => {
        if (line.startsWith('[ytfork:title] ')) {
          title = line.slice('[ytfork:title] '.length);
          options.onTitle?.(title);
        } else if (line.startsWith('[ytfork:final] ')) {
          finalPath = line.slice('[ytfork:final] '.length);
        }
      };

      const handleStderrLine = (line: string): void => {
        const update = parseLine(line);
        if (update) options.onProgress?.(update);
        stderrTail.push(line);
        if (stderrTail.length > 100) stderrTail.shift();
      };

      this.pipeLines(child.stdout, handleStdoutLine);
      this.pipeLines(child.stderr, handleStderrLine);

      child.once('error', (err) => {
        reject(new YtDlpFailedError(`yt-dlp failed to spawn: ${err.message}`));
      });

      child.once('close', (code, signal) => {
        if (code === 0 && finalPath) {
          const result: RunResult = { filePath: finalPath };
          if (title !== undefined) result.title = title;
          resolve(result);
          return;
        }
        const tail = stderrTail.slice(-5).join('\n').trim();
        const reason = signal ? `signal=${signal}` : `code=${code ?? 'null'}`;
        reject(new YtDlpFailedError(`yt-dlp exited ${reason}${tail ? `:\n${tail}` : ''}`));
      });
    });
  }

  private pipeLines(stream: Readable, onLine: (line: string) => void): void {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', onLine);
  }
}
