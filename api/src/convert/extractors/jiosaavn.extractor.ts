import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ExtractionFailedError } from '../../common/errors/domain.errors';
import { AudioNormalizer } from '../audio-normalizer.service';
import { JioSaavnClient, type SaavnTrack } from './jiosaavn.client';
import { buildTrackFilename } from './filename';
import type {
  Extractor,
  ExtractionContext,
  ExtractionResult,
  ExtractedTrack,
} from './extractor.interface';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';

/**
 * JioSaavn extractor: resolves a share link via the JioSaavn API, downloads the
 * (AAC/mp4) CDN audio, and transcodes each track to MP3.
 */
@Injectable()
export class JioSaavnExtractor implements Extractor {
  readonly name = 'jiosaavn';
  private readonly logger = new Logger(JioSaavnExtractor.name);

  constructor(
    private readonly client: JioSaavnClient,
    private readonly normalizer: AudioNormalizer,
  ) {}

  supports(url: URL): boolean {
    return JioSaavnClient.handles(url);
  }

  async run(ctx: ExtractionContext): Promise<ExtractionResult> {
    const resolution = await this.client.resolve(ctx.url, ctx.signal);
    this.logger.log(
      `JioSaavn resolved ${resolution.kind}: "${resolution.title}" (${resolution.tracks.length} track(s))`,
    );
    ctx.onTitle?.(resolution.title);

    // Single-track mode (M0/M1): take only the first track unless playlist mode
    // is requested. Full playlist fan-out + zip lands in a later milestone.
    const selected = ctx.playlist ? resolution.tracks : resolution.tracks.slice(0, 1);
    if (selected.length === 0) {
      throw new ExtractionFailedError('No tracks resolved from JioSaavn link');
    }

    const tracks: ExtractedTrack[] = [];
    for (let i = 0; i < selected.length; i++) {
      const track = selected[i];
      if (!track) continue;
      const trackNo = ctx.playlist ? i + 1 : undefined;
      tracks.push(await this.fetchTrack(track, ctx, trackNo));
    }

    return {
      tracks,
      title: resolution.title,
      kind: resolution.kind,
    };
  }

  private async fetchTrack(
    track: SaavnTrack,
    ctx: ExtractionContext,
    trackNo: number | undefined,
  ): Promise<ExtractedTrack> {
    const safeId = (track.id || 'track').replace(/[^a-zA-Z0-9_-]/g, '');
    const sourcePath = join(ctx.outputDir, `${safeId}.src`);
    const outName = buildTrackFilename({
      title: track.title,
      ...(track.artist ? { artist: track.artist } : {}),
      ...(trackNo ? { trackNo } : {}),
    });
    const outPath = join(ctx.outputDir, outName);

    await this.download(track.downloadUrl, sourcePath, ctx);

    await this.normalizer.toMp3({
      inputPath: sourcePath,
      outputPath: outPath,
      ...(track.durationSec !== undefined ? { durationSec: track.durationSec } : {}),
      tags: {
        title: track.title,
        ...(track.artist ? { artist: track.artist } : {}),
        ...(track.album ? { album: track.album } : {}),
        ...(trackNo ? { trackNo } : {}),
      },
      ...(ctx.onProgress ? { onProgress: ctx.onProgress } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    const result: ExtractedTrack = { filePath: outPath, title: track.title };
    if (track.artist) result.artist = track.artist;
    if (track.album) result.album = track.album;
    if (trackNo) result.trackNo = trackNo;
    ctx.onTrackComplete?.(result);
    return result;
  }

  private async download(url: string, destPath: string, ctx: ExtractionContext): Promise<void> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
    } catch (err) {
      throw new ExtractionFailedError(
        `JioSaavn CDN download failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok || !res.body) {
      throw new ExtractionFailedError(`JioSaavn CDN returned HTTP ${res.status}`);
    }

    const totalBytes = Number(res.headers.get('content-length') ?? 0);
    let received = 0;
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (totalBytes > 0 && ctx.onProgress) {
        ctx.onProgress({
          stage: 'download',
          percent: Math.min(100, Math.round((received / totalBytes) * 100)),
          size: formatBytes(totalBytes),
        });
      }
    });

    await pipeline(source, createWriteStream(destPath));
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)}MiB`;
}
