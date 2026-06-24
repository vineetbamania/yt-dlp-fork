import { Injectable } from '@nestjs/common';
import { basename } from 'node:path';
import { YtDlpService } from '../ytdlp.service';
import type {
  Extractor,
  ExtractionContext,
  ExtractionResult,
  ExtractedTrack,
} from './extractor.interface';

/**
 * Wraps the existing yt-dlp spawn service. Handles YouTube, YT Music,
 * SoundCloud and the long tail. Also serves as the resolver's catch-all:
 * `supports()` always returns true, so it must be ordered LAST.
 */
@Injectable()
export class YtDlpExtractor implements Extractor {
  readonly name = 'yt-dlp';

  constructor(private readonly ytdlp: YtDlpService) {}

  supports(): boolean {
    return true;
  }

  async run(ctx: ExtractionContext): Promise<ExtractionResult> {
    const result = await this.ytdlp.run({
      url: ctx.url,
      outputDir: ctx.outputDir,
      ...(ctx.onTitle ? { onTitle: ctx.onTitle } : {}),
      ...(ctx.onProgress ? { onProgress: ctx.onProgress } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    const track: ExtractedTrack = {
      filePath: result.filePath,
      title: result.title ?? basename(result.filePath),
    };
    ctx.onTrackComplete?.(track);

    return {
      tracks: [track],
      ...(result.title !== undefined ? { title: result.title } : {}),
      kind: 'track',
    };
  }
}
