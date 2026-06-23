export type Stage = 'download' | 'extract_audio' | 'metadata' | 'video_convert' | 'unknown';

export interface ProgressUpdate {
  stage: Stage;
  percent?: number;
  eta?: string;
  speed?: string;
  size?: string;
}

const STAGE_MAP: Record<string, Stage> = {
  download: 'download',
  ExtractAudio: 'extract_audio',
  Metadata: 'metadata',
  VideoConvertor: 'video_convert',
};

// e.g. "[download]  42.3% of   3.42MiB at 567.89KiB/s ETA 00:14"
//      "[download]  42.3% of    3.42MiB at  Unknown speed"
//      "[download] 100% of  3.42MiB in 00:02"
const PROGRESS_RE =
  /^\[download\]\s+(?<percent>\d+(?:\.\d+)?)%\s+of\s+~?\s*(?<size>\S+)(?:\s+at\s+(?<speed>[^\s].*?))?(?:\s+ETA\s+(?<eta>\S+)|\s+in\s+(?<elapsed>\S+))?\s*$/;

const STAGE_RE = /^\[(?<stage>\w+)\]/;

export function parseLine(line: string): ProgressUpdate | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[')) return null;

  const progress = PROGRESS_RE.exec(trimmed);
  if (progress?.groups) {
    const percentRaw = progress.groups.percent;
    const percent = percentRaw ? Number.parseFloat(percentRaw) : undefined;
    return {
      stage: 'download',
      ...(percent !== undefined && !Number.isNaN(percent) ? { percent } : {}),
      ...(progress.groups.size ? { size: progress.groups.size } : {}),
      ...(progress.groups.speed ? { speed: progress.groups.speed.trim() } : {}),
      ...(progress.groups.eta ? { eta: progress.groups.eta } : {}),
    };
  }

  const stageMatch = STAGE_RE.exec(trimmed);
  if (stageMatch?.groups?.stage) {
    const stage = STAGE_MAP[stageMatch.groups.stage];
    if (stage && stage !== 'download') {
      return { stage };
    }
  }

  return null;
}
