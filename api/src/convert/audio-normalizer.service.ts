import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Env } from '../config/env';
import { ExtractionFailedError } from '../common/errors/domain.errors';
import type { ProgressUpdate } from './ytdlp-progress.parser';

export interface NormalizeTags {
  title?: string;
  artist?: string;
  album?: string;
  trackNo?: number;
}

export interface NormalizeOptions {
  inputPath: string;
  outputPath: string;
  /** Source duration in seconds, used to compute transcode progress. */
  durationSec?: number;
  tags?: NormalizeTags;
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
}

/**
 * ffmpeg wrapper that transcodes any audio input to a broadly-compatible MP3:
 * constant bitrate + ID3v1 & ID3v2.3 tags.
 */
@Injectable()
export class AudioNormalizer {
  private readonly logger = new Logger(AudioNormalizer.name);
  private readonly bitrate: string;

  constructor(config: ConfigService<Env, true>) {
    this.bitrate = config.get('AUDIO_BITRATE', { infer: true });
  }

  toMp3(options: NormalizeOptions): Promise<string> {
    const args = [
      '-y',
      '-hide_banner',
      '-i',
      options.inputPath,
      '-vn', // drop any cover-art video stream
      '-codec:a',
      'libmp3lame',
      '-b:a',
      this.bitrate, // CBR
      '-id3v2_version',
      '3',
      '-write_id3v1',
      '1',
      ...tagArgs(options.tags),
      '-progress',
      'pipe:2',
      '-nostats',
      options.outputPath,
    ];

    this.logger.log(`ffmpeg transcode -> ${this.bitrate} CBR mp3`);

    return new Promise<string>((resolve, reject) => {
      const child = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        ...(options.signal ? { signal: options.signal } : {}),
      });

      const stderrTail: string[] = [];
      const rl = createInterface({ input: child.stderr, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const update = parseFfmpegProgress(line, options.durationSec);
        if (update) options.onProgress?.(update);
        stderrTail.push(line);
        if (stderrTail.length > 50) stderrTail.shift();
      });

      child.once('error', (err) => {
        reject(new ExtractionFailedError(`ffmpeg failed to spawn: ${err.message}`));
      });

      child.once('close', (code, signal) => {
        if (code === 0) {
          resolve(options.outputPath);
          return;
        }
        const tail = stderrTail.slice(-5).join('\n').trim();
        const reason = signal ? `signal=${signal}` : `code=${code ?? 'null'}`;
        reject(new ExtractionFailedError(`ffmpeg exited ${reason}${tail ? `:\n${tail}` : ''}`));
      });
    });
  }
}

function tagArgs(tags?: NormalizeTags): string[] {
  if (!tags) return [];
  const out: string[] = [];
  if (tags.title) out.push('-metadata', `title=${tags.title}`);
  if (tags.artist) out.push('-metadata', `artist=${tags.artist}`);
  if (tags.album) out.push('-metadata', `album=${tags.album}`);
  if (tags.trackNo && tags.trackNo > 0) out.push('-metadata', `track=${tags.trackNo}`);
  return out;
}

// ffmpeg `-progress pipe:2` emits `out_time_ms=` / `out_time_us=` lines.
// Both are microseconds (a long-standing ffmpeg quirk for out_time_ms).
const OUT_TIME_RE = /^out_time_(?:ms|us)=(\d+)$/;

export function parseFfmpegProgress(line: string, durationSec?: number): ProgressUpdate | null {
  const match = OUT_TIME_RE.exec(line.trim());
  if (!match?.[1]) return null;
  if (!durationSec || durationSec <= 0) return { stage: 'transcode' };
  const elapsedSec = Number(match[1]) / 1_000_000;
  const percent = Math.min(100, Math.round((elapsedSec / durationSec) * 100));
  return { stage: 'transcode', percent };
}
