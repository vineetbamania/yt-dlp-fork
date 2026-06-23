import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { YtDlpFailedError } from '../common/errors/domain.errors';
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

@Injectable()
export class YtDlpService {
  private readonly logger = new Logger(YtDlpService.name);

  run(options: RunOptions): Promise<RunResult> {
    const args = [
      '--no-playlist',
      '--extract-audio',
      '--audio-format',
      'mp3',
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
