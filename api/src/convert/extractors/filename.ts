/** Decode the handful of HTML entities JioSaavn/Gaana return in titles. */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

/**
 * Produce a short, ASCII-safe filename component. Some players and filesystems
 * choke on Unicode and long names, so we transliterate-by-stripping to ASCII,
 * drop filesystem-hostile characters, collapse whitespace, and cap the length.
 */
export function safeFilenamePart(raw: string, maxLen = 80): string {
  const decoded = decodeHtmlEntities(raw);
  const ascii = decoded
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^\x20-\x7e]/g, '') // drop anything non-ASCII-printable
    .replace(/[\\/:*?"<>|]/g, '') // filesystem-reserved
    .replace(/\s+/g, ' ')
    .trim();
  const cleaned = ascii.length > 0 ? ascii : 'track';
  return cleaned.slice(0, maxLen).trim();
}

/** Build "NN - Artist - Title.mp3" (track number optional), all ASCII-safe. */
export function buildTrackFilename(opts: {
  title: string;
  artist?: string;
  trackNo?: number;
}): string {
  const parts: string[] = [];
  if (opts.trackNo && opts.trackNo > 0) {
    parts.push(String(opts.trackNo).padStart(2, '0'));
  }
  if (opts.artist) parts.push(safeFilenamePart(opts.artist, 40));
  parts.push(safeFilenamePart(opts.title, 80));
  return `${parts.join(' - ')}.mp3`;
}
