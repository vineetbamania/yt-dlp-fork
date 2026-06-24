import CryptoJS from 'crypto-js';
import { ExtractionFailedError } from '../../common/errors/domain.errors';
import { decodeHtmlEntities } from './filename';

/**
 * Isolated JioSaavn API knowledge. Everything that breaks when JioSaavn changes
 * their site lives HERE so the extractor never needs touching.
 *
 * Verified live 2026-06-24:
 *  - share links resolve via `webapi.get&token=<last-path-segment>&type=song|album|playlist`
 *  - each song carries `more_info.encrypted_media_url` (DES-ECB, key "38346591")
 *  - decrypting yields `https://aac.saavncdn.com/.../<hash>_96.mp4`; swap the
 *    `_96` suffix for `_320` when `more_info["320kbps"] === "true"`
 *  - the CDN serves AAC-in-mp4 (must be transcoded to MP3 downstream)
 */

const API_BASE = 'https://www.jiosaavn.com/api.php';
const DES_KEY = '38346591';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';

export type SaavnType = 'song' | 'album' | 'playlist';

export interface SaavnTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  /** Decrypted, best-available-bitrate direct CDN URL (AAC/mp4). */
  downloadUrl: string;
}

export interface SaavnResolution {
  kind: 'track' | 'playlist';
  /** Collection title for albums/playlists, else the single track's title. */
  title: string;
  tracks: SaavnTrack[];
}

interface RawSong {
  id?: string;
  title?: string;
  subtitle?: string;
  more_info?: {
    encrypted_media_url?: string;
    '320kbps'?: string;
    album?: string;
    duration?: string;
    artistMap?: { primary_artists?: { name?: string }[] };
    music?: string;
  };
}

export class JioSaavnClient {
  static handles(url: URL): boolean {
    return /(^|\.)(jio)?saavn\.com$/i.test(url.hostname);
  }

  async resolve(rawUrl: string, signal?: AbortSignal): Promise<SaavnResolution> {
    const canonical = await this.canonicalize(rawUrl, signal);
    const { type, token } = parseTypeAndToken(canonical);
    const json = await this.webapiGet(token, type, signal);
    return this.normalize(type, json);
  }

  /** Follow short (`/s/...`) links to their canonical perma URL. */
  private async canonicalize(rawUrl: string, signal?: AbortSignal): Promise<string> {
    const url = new URL(rawUrl);
    if (!url.pathname.startsWith('/s/')) return rawUrl;
    try {
      const res = await fetch(rawUrl, {
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
        ...(signal ? { signal } : {}),
      });
      return res.url || rawUrl;
    } catch {
      return rawUrl; // best-effort; parseTypeAndToken still tries the original
    }
  }

  private async webapiGet(token: string, type: SaavnType, signal?: AbortSignal): Promise<unknown> {
    const params = new URLSearchParams({
      __call: 'webapi.get',
      token,
      type,
      p: '1',
      n: '200', // covers most albums/playlists in one shot (M3 will paginate if needed)
      includeMetaTags: '0',
      ctx: 'web6dot0',
      api_version: '4',
      _format: 'json',
      _marker: '0',
    });
    let res: Response;
    try {
      res = await fetch(`${API_BASE}?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      throw new ExtractionFailedError(
        `JioSaavn API request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      throw new ExtractionFailedError(`JioSaavn API returned HTTP ${res.status}`);
    }
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new ExtractionFailedError('JioSaavn API returned a non-JSON response');
    }
  }

  private normalize(type: SaavnType, json: unknown): SaavnResolution {
    const root = json as RawSong & {
      songs?: RawSong[];
      list?: RawSong[];
      listname?: string;
    };
    if (type === 'song') {
      // type=song responses wrap the song in `songs[0]`; fall back to root itself.
      const song = root.songs?.[0] ?? root;
      const track = this.toTrack(song);
      return { kind: 'track', title: track.title, tracks: [track] };
    }

    const rawSongs = root.songs ?? root.list;
    if (!Array.isArray(rawSongs) || rawSongs.length === 0) {
      throw new ExtractionFailedError('JioSaavn returned no playable tracks for this link');
    }
    const title = decodeHtmlEntities(
      firstNonEmpty(root.title, root.listname) ?? 'JioSaavn collection',
    );
    const tracks = rawSongs.map((s) => this.toTrack(s));
    return { kind: 'playlist', title, tracks };
  }

  private toTrack(song: RawSong): SaavnTrack {
    const encrypted = song.more_info?.encrypted_media_url;
    if (!encrypted) {
      throw new ExtractionFailedError(`JioSaavn track "${song.title ?? '?'}" has no media URL`);
    }
    const has320 = song.more_info?.['320kbps'] === 'true';
    const downloadUrl = bestQualityUrl(decryptMediaUrl(encrypted), has320);

    const primaryArtists = song.more_info?.artistMap?.primary_artists
      ?.map((a) => a.name)
      .filter((n): n is string => !!n)
      .join(', ');
    const artist = firstNonEmpty(primaryArtists, song.more_info?.music, song.subtitle);

    const durationRaw = song.more_info?.duration;
    const durationSec = durationRaw ? Number(durationRaw) : undefined;

    return {
      id: song.id ?? '',
      title: decodeHtmlEntities(song.title ?? 'Unknown'),
      ...(artist ? { artist: decodeHtmlEntities(artist) } : {}),
      ...(song.more_info?.album ? { album: decodeHtmlEntities(song.more_info.album) } : {}),
      ...(durationSec !== undefined && !Number.isNaN(durationSec) ? { durationSec } : {}),
      downloadUrl,
    };
  }
}

/** First value that is a non-blank string, else undefined. */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) return value;
  }
  return undefined;
}

/** DES-ECB / PKCS5 decryption of `encrypted_media_url`. Pure JS (no OpenSSL legacy). */
export function decryptMediaUrl(encrypted: string): string {
  const key = CryptoJS.enc.Utf8.parse(DES_KEY);
  const decrypted = CryptoJS.DES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(encrypted) }),
    key,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  );
  const url = decrypted.toString(CryptoJS.enc.Utf8);
  if (!/^https?:\/\//.test(url)) {
    throw new ExtractionFailedError('JioSaavn media URL failed to decrypt');
  }
  return url;
}

/** Upgrade the bitrate suffix to 320 when the track advertises 320kbps. */
export function bestQualityUrl(decryptedUrl: string, has320: boolean): string {
  return has320 ? decryptedUrl.replace(/_\d+\.mp4$/, '_320.mp4') : decryptedUrl;
}

/** Derive the API `type` and `token` from any JioSaavn perma URL. */
export function parseTypeAndToken(rawUrl: string): { type: SaavnType; token: string } {
  const url = new URL(rawUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const token = segments[segments.length - 1] ?? '';
  if (!token) {
    throw new ExtractionFailedError('Could not extract a JioSaavn token from the URL');
  }
  const path = url.pathname.toLowerCase();
  let type: SaavnType = 'song';
  if (path.includes('/album/')) type = 'album';
  else if (path.includes('/featured/') || path.includes('/playlist/')) type = 'playlist';
  return { type, token };
}
