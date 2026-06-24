# Research: Downloading MP3s from shared music links (multi-platform)

> **Date:** 2026-06-24
> **Question:** What third-party / enthusiast tooling exists to download MP3 audio from shared
> links across JioSaavn, Gaana, Spotify, Apple Music, YouTube/YT Music, and SoundCloud — and
> what is the right architecture given this repo (NestJS + yt-dlp, single-user, Tailscale, end
> goal = MP3s of songs/playlists onto the user's devices)?
>
> Method: fan-out web search across 5 angles → 21 sources fetched → 94 claims extracted →
> 25 adversarially fact-checked (3-vote, need 2/3 to refute) → 24 confirmed, 1 refuted.

---

## TL;DR

1. **On-device extraction on iOS is a dead end.** No source confirmed a reliable `yt-dlp`-on-iOS
   pipeline. Apple's sandbox forbids spawning the `ffmpeg` binary that does the actual MP3
   transcode, there's no real background execution, and file landing is awkward. Treat
   iSH/Pythonista/Pyto as unproven for a _reliable_ tool.
2. **Keep the engine server-side** (which is exactly what this repo already does). The phone is a
   thin client: a browser, an iOS Shortcut hitting the API, or — optionally later — a sideloaded
   SwiftUI client.
3. **There is no single tool.** Each platform needs a different extraction path. The unifying
   design is a **router**: detect the URL host → dispatch to the right extractor → normalise to MP3.

---

## The core platform reality

| Platform               | Direct audio?      | How tools actually get the audio                                                             | Output path                  |
| ---------------------- | ------------------ | -------------------------------------------------------------------------------------------- | ---------------------------- |
| **YouTube / YT Music** | ✅ yes             | `yt-dlp` extracts the stream directly                                                        | already works in this repo   |
| **SoundCloud**         | ✅ yes             | `yt-dlp` (native extractor)                                                                  | already works in this repo   |
| **JioSaavn**           | ✅ yes (best case) | Reverse-engineered API returns a **decrypted CDN URL up to 320 kbps** (`.m4a`)               | download → `ffmpeg` → MP3    |
| **Gaana**              | ⚠️ via stream      | Reverse-engineered API returns **m3u8 / streaming URLs**                                     | `ffmpeg` mux → MP3           |
| **Spotify**            | ❌ **no** (DRM)    | Read playlist **metadata**, then **re-source the audio from YouTube** (spotDL pattern)       | `yt-dlp` search → MP3, retag |
| **Apple Music**        | ❌ **no** (DRM)    | `gamdl` decrypts **your own paid subscription** stream (needs active subscription + cookies) | heavyweight; phase 2         |

**The single most important fact:** Spotify and Apple Music hand you _no extractable audio_. Every
"Spotify downloader" reads the track list, then downloads a _YouTube match_ of each song. Quality
and correctness therefore depend on the YouTube match, not on Spotify.

---

## Verified findings by platform

### Spotify & Apple Music (DRM — metadata-match)

- **spotDL** (`spotDL/spotify-downloader`) — ✅ verified: matches Spotify songs/playlists to YouTube
  and downloads via `yt-dlp`. The de-facto standard. Python CLI.
- **Downtify** (`henriquesebastiao/downtify`) — ✅ verified: self-hosted web UI; pipeline is `yt-dlp`
  under the hood; outputs MP3 / FLAC / M4A / OGG / OPUS.
- **SpotiArr** (`mralexsaavedra/spotiarr`) — ✅ verified: full-stack **TypeScript** self-hosted
  Spotify downloader (closest to this repo's stack).
- **gamdl** (`glomatico/gamdl`) — ✅ verified: downloads from Apple Music but **requires an active
  paid Apple Music subscription** (decrypts your legitimate stream).
- **librespot** (`librespot-org/librespot`) — ⚠️ **the one refuted claim**: it is a Spotify
  _streaming / Connect_ client; its download/extraction capability is disputed. **Do not build the
  downloader on librespot.**

### JioSaavn & Gaana (reverse-engineered APIs — direct audio)

- **saavn.dev** — ✅ verified: unofficial reverse-engineered JioSaavn API; **free, open-source
  (MIT), self-hostable**; returns **direct download links up to 320 kbps**.
- **sumitkolhe/jiosaavn-api** & **anxkhn/jiosaavn-api** — ✅ verified: unofficial, self-hostable;
  return **decrypted media URLs at 320 kbps**.
- **cyberboysumanjay/JioSaavnAPI** — ✅ verified: unofficial Python 3 / Flask wrapper.
- **Gaana** (`cyberboysumanjay/GaanaAPI`, `ZingyTomato/GaanaPy`) — ✅ verified: unofficial
  reverse-engineered REST APIs returning JSON metadata + **m3u8 streaming URLs** (needs `ffmpeg`).

> These Indian-platform APIs are the **cleanest targets** — they return a real CDN URL, so no
> lossy "find it on YouTube" guesswork. For JioSaavn the audio is essentially the original.

### YouTube / YT Music / SoundCloud

- **yt-dlp** natively (already in this repo), or **MeTube** (`alexta69/metube`) — ✅ verified:
  self-hosted browser UI wrapping `yt-dlp` with audio-only output.

### Self-hosted "all-in-one" references worth reading

- **playlistdl** (`TannerNelson16/playlistdl`) — ✅ verified: self-hosted multi-source playlist
  downloader (good prior art for the router idea).

---

## The iOS angle (why server-side wins)

### Running the engine on iOS — not viable

- `iSH` (x86 Alpine emulator), `a-Shell`, Pythonista, Pyto: people _attempt_ `yt-dlp`, but **no
  source confirmed a reliable end-to-end MP3 pipeline**. The breaking point is `ffmpeg`
  post-processing — Apple's sandbox forbids spawning arbitrary executables, there's no JIT/`exec`
  for unsigned binaries, no real background execution, and restricted file landing.
- `tucomel/yt-dlp-ios` exists but is experimental, not a maintained app.

### Sideloading a personal app — viable but optional

- **Free Apple developer cert** — ✅ verified: sideloaded apps **expire after 7 days** (and a small
  app cap); requires periodic re-signing.
- **SideStore** (`SideStore/SideStore`) — ✅ verified: an AltStore fork that **does not require a
  desktop running**; it re-signs apps **on-device over the network**, automating the weekly expiry.
- **Paid Apple Developer ($99/yr)** — certs last a year; removes the weekly dance.

**Conclusion:** a native app is _possible_ (build in Xcode → sideload via SideStore), but it buys
you little over a browser/Shortcut client and adds the cert-maintenance burden. Recommended only if
the web UX proves annoying.

---

## What this means for the build

- **Extend, don't replace.** This repo's `convert` module (URL → spawn → SSE progress → MP3
  download) is the right spine. Add a **source-router** layer in front of the extractor.
- **Hybrid extraction stack:**
  - `yt-dlp` (have it) → YouTube, YT Music, SoundCloud, and the long tail.
  - **Native TypeScript HTTP clients** → JioSaavn, Gaana (just HTTP + `ffmpeg`; no Python needed).
  - **spotDL** (Python CLI, shell out like `yt-dlp`) → Spotify metadata-match.
  - **Apple Music / `gamdl`** → phase 2, optional (needs a paid subscription + cookies).
- **New dimension: playlists.** Today the app runs `--no-playlist` (single track). Multi-track
  output → return a **ZIP of MP3s** (easy bulk download).
- **Broadly-compatible encoding:** CBR MP3 (128–192 kbps), clean ID3v1+v2 tags, short ASCII
  filenames — maximises playback across players and filesystems.

---

## Legal / operational caveats

- The Spotify/Apple/JioSaavn/Gaana paths use **reverse-engineered APIs / DRM workarounds** — a
  legal grey area. For single-user personal use of music you have access to, that's your call.
- These community projects get DMCA'd and vanish periodically. **Pin versions and/or vendor-fork**
  the ones you depend on (you already fork `yt-dlp`, so the muscle memory exists).
- JioSaavn/Gaana APIs are unofficial and can break when the upstream site changes — build the
  extractors defensively (treat upstream shape as untrusted, fail the job cleanly).

---

## Key sources (verified primary)

- Spotify / match: [spotDL](https://github.com/spotDL/spotify-downloader) ·
  [SpotiArr (TS)](https://github.com/mralexsaavedra/spotiarr) ·
  [Downtify](https://github.com/henriquesebastiao/downtify)
- Apple Music: [gamdl](https://github.com/glomatico/gamdl)
- JioSaavn: [saavn.dev docs](https://saavn.dev/docs) ·
  [sumitkolhe/jiosaavn-api](https://github.com/sumitkolhe/jiosaavn-api) ·
  [anxkhn/jiosaavn-api](https://github.com/anxkhn/jiosaavn-api) ·
  [cyberboysumanjay/JioSaavnAPI](https://github.com/cyberboysumanjay/JioSaavnAPI)
- Gaana: [GaanaAPI](https://github.com/cyberboysumanjay/GaanaAPI) ·
  [GaanaPy](https://github.com/ZingyTomato/GaanaPy)
- YouTube/SoundCloud: [MeTube](https://github.com/alexta69/metube)
- Multi-source prior art: [playlistdl](https://github.com/TannerNelson16/playlistdl)
- iOS sideloading: [SideStore](https://github.com/SideStore/SideStore)
