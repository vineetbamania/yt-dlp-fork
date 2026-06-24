import type { ProgressUpdate } from '../ytdlp-progress.parser';

/** Output audio container. Only mp3 today; room to grow (flac/m4a) later. */
export type AudioFormat = 'mp3';

/** One produced audio file plus the real metadata to tag it with. */
export interface ExtractedTrack {
  filePath: string;
  title: string;
  artist?: string;
  album?: string;
  trackNo?: number;
}

/** Everything an extractor needs to do its job, plus progress callbacks. */
export interface ExtractionContext {
  url: string;
  /** The job's temp dir; all files must land here (TempDirService-confined). */
  outputDir: string;
  format: AudioFormat;
  /** When false, a playlist URL should resolve to its single "current" track. */
  playlist: boolean;
  onTitle?: (title: string) => void;
  onProgress?: (update: ProgressUpdate) => void;
  /** Fired once per track as it finishes (drives per-track playlist progress). */
  onTrackComplete?: (track: ExtractedTrack) => void;
  signal?: AbortSignal;
}

export interface ExtractionResult {
  /** One entry for a single song, N for an album/playlist. */
  tracks: ExtractedTrack[];
  /** Playlist/album title, or the single track's title. */
  title?: string;
  kind: 'track' | 'playlist';
}

/**
 * A per-platform strategy that turns a URL into one or more audio files.
 * The SourceResolver picks the first extractor whose `supports()` returns true,
 * with the yt-dlp catch-all last.
 */
export interface Extractor {
  readonly name: string;
  supports(url: URL): boolean;
  run(ctx: ExtractionContext): Promise<ExtractionResult>;
}

/** DI token for the ordered extractor list (specific first, yt-dlp catch-all last). */
export const EXTRACTORS = Symbol('EXTRACTORS');
