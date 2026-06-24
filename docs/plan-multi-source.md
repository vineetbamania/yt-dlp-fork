# Plan: Multi-source MP3 downloader (server-side)

> **Status:** proposed · **Date:** 2026-06-24
> **Companion:** [research-music-download-tooling.md](./research-music-download-tooling.md)
> **Extends:** the existing `convert` module ([architecture.md](./architecture.md))

## Goal

Turn the single-source (`yt-dlp` only) converter into a **multi-source router** that accepts a
shared link from any of: YouTube / YT Music, SoundCloud, **JioSaavn, Gaana, Spotify** (and Apple
Music in a later phase), and returns MP3(s) — including **playlists** as a ZIP.

Keep every existing invariant: single-user, Tailscale-only, one bearer token, in-memory jobs,
spawn-not-shell, temp-dir confinement, SSE progress. **Extend, don't rewrite.**

## Non-goals

- No native iOS app (research concluded server-side wins; phone stays a thin browser/Shortcut
  client). Revisit only if web UX proves painful.
- No DB / queue / multi-user. Still single process, in-memory.
- No transcoding farm — sequential within a job is fine for one user.

---

## Architecture: the source router

The current flow is `validateUrl → jobs.create → ytdlp.run → markDone`. We insert a **resolver**
that picks an **extractor strategy** by URL host. `YtDlpService` becomes _one_ strategy behind a
common interface; new strategies sit beside it.

```
POST /convert {url, format?}
        |
        v
  validateUrl()                      (existing, + new allowed hosts)
        |
        v
  SourceResolver.resolve(url) ------> picks first Extractor whose supports(url) is true
        |                              fallback = YtDlpExtractor (catch-all)
        v
  Extractor.run(ctx) --------------> emits onTitle / onProgress / onTrackComplete
        |                              writes 1..N audio files into job tempDir
        v
  AudioNormalizer (ffmpeg) --------> each file -> CBR MP3 + ID3 tags
        |
        v
  if files.length > 1 -> zip       (playlist)
  markDone(file | zip)
```

### The `Extractor` interface

New file `api/src/convert/extractors/extractor.interface.ts`:

```ts
export interface ExtractionContext {
  url: string;
  outputDir: string; // the job tempDir
  format: AudioFormat; // 'mp3' (default) — room for flac/m4a later
  onTitle?: (title: string) => void;
  onProgress?: (u: ProgressUpdate) => void; // reuse existing ProgressUpdate
  onTrackComplete?: (file: ExtractedTrack) => void; // playlist progress
  signal?: AbortSignal;
}

export interface ExtractedTrack {
  filePath: string;
  title: string;
  artist?: string;
  album?: string;
  trackNo?: number;
}

export interface ExtractionResult {
  tracks: ExtractedTrack[]; // 1 for a single song, N for a playlist/album
  title?: string; // playlist/album title, or the single track title
}

export interface Extractor {
  readonly name: string; // 'yt-dlp' | 'jiosaavn' | 'gaana' | 'spotify'
  supports(url: URL): boolean;
  run(ctx: ExtractionContext): Promise<ExtractionResult>;
}
```

`SourceResolver` (`extractors/source-resolver.ts`) holds an ordered list of extractors (injected),
returns the first match, defaults to `YtDlpExtractor`.

### Why this shape

- **`ExtractionResult.tracks[]`** is the key change — it generalises today's single `filePath` to
  N tracks, which is what unlocks playlists with zero special-casing in the controller.
- Existing `ProgressUpdate` / `Stage` are reused as-is; we add stages `match` (Spotify→YT search)
  and `transcode`.
- The existing `ytdlp.service.ts` is wrapped by `YtDlpExtractor` with almost no change — we drop
  `--no-playlist` conditionally and parse N final paths instead of one.

---

## Extractor designs

### 1. `YtDlpExtractor` — YouTube / YT Music / SoundCloud / long tail _(adapt existing)_

- Wraps current `YtDlpService`. `supports()` returns `true` for known yt-dlp hosts **and** acts as
  the resolver's fallback.
- Change: gate `--no-playlist` on whether the URL is a playlist and the user opted into playlist
  mode. Capture **multiple** `after_move` final paths (the `[ytfork:final]` print already fires per
  file — collect into an array).
- Everything else (spawn, stderr line parsing, SSE) is unchanged.

### 2. `JioSaavnExtractor` — native TypeScript (no Python) _(cleanest path)_

- JioSaavn is HTTP + a decryptable media URL → trivial in Node.
- `supports()`: hosts `jiosaavn.com`, `saavn.com`, `www.jiosaavn.com`.
- Flow:
  1. Resolve the share URL → song/album/playlist id (follow redirects for short links).
  2. Call the JioSaavn endpoint(s) to get metadata + `encrypted_media_url`.
  3. Decrypt to the **320 kbps `.m4a` CDN URL** (DES-based scheme used by the community APIs).
  4. Stream-download each track to `outputDir`, emit `onProgress` (bytes), then hand to normalizer.
- **Build decision:** implement the API calls in-house (reference: `sumitkolhe/jiosaavn-api`,
  `saavn.dev`) rather than depend on a hosted instance — no external runtime dependency, no rate
  limit surprises. Keep the endpoint logic in one file so it's easy to patch when JioSaavn changes.
- Playlists/albums: iterate track ids; `onTrackComplete` per track.

### 3. `GaanaExtractor` — native TypeScript + ffmpeg

- `supports()`: host `gaana.com`.
- Flow: resolve id → API returns metadata + **m3u8** stream URL → `ffmpeg -i <m3u8> ... out.mp3`
  (ffmpeg both fetches and transcodes the HLS stream). Reference: `GaanaAPI`, `GaanaPy`.
- Lower priority than JioSaavn (Gaana usage has declined; m3u8 path is more fragile).

### 4. `SpotifyExtractor` — **in-house TypeScript** (decided: no spotDL/Python)

- `supports()`: host `open.spotify.com`.
- Spotify has **no audio** — so we replicate spotDL's _pattern_ in TS:
  1. **Metadata** via the Spotify Web API (Client Credentials flow) — resolve a track/album/playlist
     URL into track records (`title`, `artist(s)`, `album`, `duration`, `track_no`, ISRC).
  2. **Audio match** by reusing `YtDlpExtractor` with a search target — `yt-dlp "ytsearch1:<artist>
     <title> audio"` (optionally filter by duration proximity to reduce wrong matches).
  3. **Retag** the resulting MP3 with the _real_ Spotify metadata via the normalizer (don't trust
     the YouTube title).
- Needs a free **Spotify app client id/secret** (metadata API) → new env vars (below). If unset, the
  Spotify extractor is disabled and `open.spotify.com` URLs fail with a clear message.
- Rationale: keeps the whole stack JS/TS (the user's strength), no Python beyond `yt-dlp`, full
  control over match heuristics. Trade-off accepted: we own the match-quality logic.
- A small `SpotifyClient` (`spotify.client.ts`) isolates token fetch + the 3 URL shapes
  (track/album/playlist); the extractor composes it with the yt-dlp search path.

### 5. Apple Music — **out of scope** (decided)

- `gamdl` requires a paid subscription + cookies. Removed from the build. Most Apple Music tracks
  are re-sourceable via Spotify/JioSaavn/YouTube if ever needed.

---

## Cross-cutting: audio normalization

New `AudioNormalizer` service (`convert/audio-normalizer.service.ts`), `ffmpeg` wrapper applied to
**every** extractor's output:

- `-codec:a libmp3lame -b:a 192k` (CBR for broad player compatibility).
- Write **ID3v1 + ID3v2.3** tags: `-id3v2_version 3 -write_id3v1 1`, fill
  `title/artist/album/track` from `ExtractedTrack`.
- Filenames: `NN - Artist - Title.mp3`, ASCII-only, short. Reuse the existing
  `--restrict-filenames` philosophy; add a `sanitizeFilename()` helper (strip non-ASCII, cap
  length).
- Skip re-encode when a source is _already_ compliant MP3 to save time (optional optimisation).

---

## Playlist → folder-in-ZIP _(decided)_

- **Single song → bare `.mp3`** (today's behavior, unchanged).
- **Playlist/album → a ZIP containing a folder** of the MP3s:
  `<PlaylistTitle>.zip` → `<PlaylistTitle>/NN - Artist - Title.mp3`. Unzipping on the Mac/iPhone
  yields a ready-to-use folder of tracks.
- Implementation: after normalization, if `ExtractionResult.tracks.length > 1`, zip the files under
  a single top-level folder (`archiver` npm pkg) into `outputDir/<PlaylistTitle>.zip`.
- Job records `filePath` = the zip, `fileName` = `<PlaylistTitle>.zip`, content type
  `application/zip`. The `/jobs/:id/download` endpoint switches content type by extension
  (`.mp3` → `audio/mpeg`, `.zip` → `application/zip`).

---

## Concrete change list (by file)

**New**

- `convert/extractors/extractor.interface.ts` — interface + types above.
- `convert/extractors/source-resolver.ts` — host → extractor dispatch.
- `convert/extractors/ytdlp.extractor.ts` — wraps existing `YtDlpService`.
- `convert/extractors/jiosaavn.extractor.ts` + `jiosaavn.client.ts` (+ `.spec.ts`).
- `convert/extractors/gaana.extractor.ts` + `gaana.client.ts`.
- `convert/extractors/spotify.extractor.ts` + `spotify.client.ts` (Web API metadata + yt-dlp match).
- `convert/audio-normalizer.service.ts` (+ `.spec.ts`).
- `convert/zip.service.ts`.

**Modified**

- `convert/types.ts` — `Job` gains `files?: string[]` / `kind: 'track' | 'playlist'`;
  `ExtractionResult` plumbed through.
- `convert/ytdlp-progress.parser.ts` — add `match` + `transcode` stages.
- `convert/convert.controller.ts` — `runJob` calls `SourceResolver` → extractor →
  normalizer → (zip?) → `markDone`; download endpoint picks content type by extension.
- `convert/jobs.service.ts` — store N files; SSE `done` payload unchanged (still one downloadUrl).
- `convert/convert.module.ts` — provide the extractors + resolver + normalizer + zip.
- `convert/dto/create-convert.dto.ts` — optional `format` and `playlist: boolean` (default false).
- `convert/url-validator.ts` — keep SSRF blocklist; the new hosts are public so no change needed,
  but add a known-host allowlist note (we still let yt-dlp's catch-all handle anything else).
- `config/env.ts` — add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (optional; Spotify disabled if
  unset), `AUDIO_BITRATE` (default `192k`), `ENABLE_PLAYLISTS` (default true).
- `.env.example`, `README.md` (document Spotify creds + new hosts).
- `package.json` — add `archiver`. No new system binaries (yt-dlp + ffmpeg already required).

---

## Dependencies

| Dep               | Why                           | How                                           |
| ----------------- | ----------------------------- | --------------------------------------------- |
| `ffmpeg`          | already required              | brew / apt (in Docker)                        |
| `yt-dlp`          | already required              | already installed                             |
| `archiver` (npm)  | zip playlists (folder-in-zip) | `npm i archiver`                              |
| Spotify app creds | Spotify Web API metadata      | free; user registers one app, sets 2 env vars |

**No Python beyond `yt-dlp`** (Spotify is in-house TS). **No `spotdl`, no `gamdl`.** JioSaavn/Gaana/
Spotify metadata all use `fetch` (Node 22 global fetch) + `node:crypto`; audio comes from yt-dlp/
ffmpeg already present.

---

## Phasing (milestones)

- **M0 — Refactor to router (no behavior change).** ✅ **DONE** (verified 2026-06-24). `Extractor`
  interface, `YtDlpExtractor` wrapping `YtDlpService`, `SourceResolver` dispatch. All tests green.
- **M1 — JioSaavn.** ✅ **DONE** (verified live 2026-06-24). Native-TS client (DES decrypt via
  `crypto-js`, `_320.mp4` upgrade), extractor (stream download → ffmpeg transcode), `AudioNormalizer`
  pulled forward (CBR MP3 + ID3v1/v2.3 tags), `filename` sanitizer. 24 new unit tests. Live-verified
  song + 40-track playlist resolution + CDN audio fetch. _ffmpeg transcode unverified in CI sandbox
  (no binary) — runs on the Mac._
- **M2 — Consistent MP3 output across all sources.** Make yt-dlp emit CBR MP3 + ID3v1/v2.3 directly
  so YouTube/SoundCloud output matches the JioSaavn path (no wasteful re-encode). ✅ **DONE.**
- **M3 — Playlists + folder-in-ZIP.** Flip `playlist` plumbing through DTO→controller→extractor;
  `zip.service.ts`; download endpoint content-type by extension. JioSaavn client already returns all
  tracks; yt-dlp playlist support (drop `--no-playlist`, collect N final paths).
- **M4 — Spotify (in-house TS).** Spotify Web API metadata → yt-dlp `ytsearch` audio → retag.
- **M5 — Gaana.** m3u8 path.
- _(Apple Music: out of scope.)_

Each milestone is independently shippable and leaves the app working.

---

## Testing

- **Unit (no network):** `SourceResolver` host dispatch; `jiosaavn.client` decrypt + URL parsing
  against captured fixtures; filename sanitizer; spotDL/yt-dlp progress parsers (extend existing
  `*.parser.spec.ts` style); zip service.
- **Integration (guarded, network):** one real track per source behind an env flag so CI stays
  offline. Keep fixtures for the API JSON shapes so unit tests don't hit the network.
- **e2e:** extend `test/convert.e2e-spec.ts` — POST a (mocked-extractor) job, assert SSE
  `state→progress→done`, assert download content type for track vs. playlist.

---

## Risks & mitigations

- **Unofficial APIs break** (JioSaavn/Gaana change shape) → isolate all upstream knowledge in the
  `*.client.ts` files; extractors fail the job with a clear `code` so the UI shows a clean error.
- **spotDL flakiness / YT match quality** → it's a CLI we spawn; pin its version, surface its
  stderr tail (like yt-dlp already does).
- **Legal/grey area** → single-user personal use; pin/vendor-fork deps (see research caveats).
- **Long playlists block the single process** → acceptable for one user; add a soft per-job track
  cap (env) to avoid runaway jobs.

---

## Client: iOS Shortcut (decided 2026-06-24)

The phone client is an **iOS Shortcut**, not a native app and not (primarily) the web UI. This
confirms NestJS as the right backend: the workload is a persistent process that spawns
`yt-dlp`/`ffmpeg`, holds job state, and serves files — Next.js/serverless would actively fight it,
and with a Shortcut client there's no rich frontend to justify a frontend framework.

**Key constraint:** Shortcuts is a request/response engine and **cannot cleanly consume SSE**. So
the Shortcut uses the **polling** endpoint (`GET /jobs/:id`), which already exists alongside the SSE
stream. No backend change required — SSE stays for the (optional) browser UI; polling serves the
Shortcut.

**Shortcut flow:**

```
Share Sheet (Spotify/JioSaavn/YouTube link)
  → Get Contents of URL:  POST /convert   { url }            (Authorization: Bearer <token>)
  → Repeat: Get Contents of URL:  GET /jobs/:id              until .status == "done" | "failed"
  → Get Contents of URL:  GET /jobs/:id/download             (mp3, or zip for a playlist)
  → Save File to Files / iCloud Drive
```

Implications for the API (mostly already satisfied):

- Keep `GET /jobs/:id` returning a clean `status` field for poll loops. ✅ exists.
- `/jobs/:id/download` must set correct `Content-Type` + `Content-Disposition` for both `.mp3` and
  (M3) `.zip` so Shortcuts/Files names the saved file properly. ✅ for mp3; zip in M3.
- The web `web/` frontend becomes **optional** (convenience/debug). Not removed, not required.

## Deployment (full strategy authored after development)

Decide between the two paths already present in the repo:

- **Mac + launchd over Tailscale** (`scripts/install-launchd.sh`, `issue-tls.sh`) — files land on
  your always-on Mac, reachable from the iPhone over the tailnet. **Likely primary.**
- **Docker + Render** (`Dockerfile`, `render.yaml`) — public-ish, but downloads then need pulling
  to the Mac. Keep as the portable/remote option.

The detailed deployment doc (dep install incl. `spotdl`, env/secrets, Tailscale TLS, update script
for yt-dlp + spotdl) will be written once M1–M4 land and we know the exact runtime footprint.

---

## Decisions (locked 2026-06-24)

1. **Spotify:** in-house TypeScript (Spotify Web API metadata + yt-dlp `ytsearch`). No spotDL/Python.
2. **Platforms:** all in scope — JioSaavn, Gaana, Spotify, YouTube/YT Music, SoundCloud.
3. **Apple Music:** out of scope (requires paid subscription).
4. **Output:** single song → bare `.mp3`; playlist/album → folder-in-ZIP.
