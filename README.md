# yt-dlp-fork

Personal YouTube/media → MP3 tool. NestJS API + plain HTML/CSS/JS frontend, served as one process. **Tailscale-only — never expose to the public internet.**

End goal: MP3s land on iPhone via Safari → Files, then sync to microSD for a Nokia 3210 4G.

---

## Setup

```sh
# 1. External CLI dependencies (yt-dlp, ffmpeg, deno)
brew install yt-dlp ffmpeg deno
npm run check-deps           # verifies the above

# 2. Node + project deps
nvm use                      # Node 22 LTS (uses .nvmrc)
npm install                  # installs root + workspace + husky

# 3. Config
cp .env.example .env
# edit .env — generate AUTH_TOKEN with:
#   openssl rand -hex 32
```

## Run

```sh
npm run dev                  # NestJS + static web on http://localhost:8787
# or:
npm run build && npm start   # production-mode (NODE_ENV=production)
```

Open `http://<mac-tailnet-host>:8787/` from your iPhone. First visit, paste your `AUTH_TOKEN`; it's stored in `localStorage` on that device.

### iOS: add to Home Screen (optional but recommended)

Safari → Share → **Add to Home Screen**. This:

- Gives you a fullscreen, app-like icon
- Reduces the risk of [Intelligent Tracking Prevention](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) clearing the localStorage token after 7 days of inactivity

## Scripts

| Command                   | What                                                 |
| ------------------------- | ---------------------------------------------------- |
| `npm run setup`           | Run dep-check, then `npm install`                    |
| `npm run check-deps`      | Verify yt-dlp / ffmpeg / deno are installed          |
| `npm run update-ytdlp`    | Update yt-dlp (auto-detects brew vs. self-installed) |
| `npm run dev`             | API + static, watch mode                             |
| `npm start`               | Production-mode                                      |
| `npm run build`           | Compile `api/` to `api/dist/`                        |
| `npm run lint`            | ESLint + Prettier check                              |
| `npm run format`          | Prettier write all files                             |
| `npm run typecheck`       | `tsc --noEmit`                                       |
| `npm test`                | Unit tests (Jest)                                    |
| `npm run test:e2e`        | End-to-end tests (mocked yt-dlp)                     |
| `npm run issue-tls`       | Issue a Tailscale TLS cert for this Mac              |
| `npm run install-agent`   | Install the launchd agent (auto-start on login)      |
| `npm run uninstall-agent` | Remove the launchd agent                             |

## Configuration

| Env var         | Default                    | Purpose                                                        |
| --------------- | -------------------------- | -------------------------------------------------------------- |
| `AUTH_TOKEN`    | _(required, min 32 chars)_ | Bearer token for the API and the SPA                           |
| `PORT`          | `8787`                     | HTTP(S) port                                                   |
| `TMP_DIR`       | `./tmp`                    | Working dir for per-job downloads (auto-created, auto-cleaned) |
| `NODE_ENV`      | `development`              | `production` hides Swagger UI                                  |
| `LOG_LEVEL`     | `info`                     | `fatal` / `error` / `warn` / `info` / `debug` / `trace`        |
| `TLS_CERT_PATH` | _(unset)_                  | When set with `TLS_KEY_PATH`, the API listens HTTPS instead    |
| `TLS_KEY_PATH`  | _(unset)_                  | Pair with `TLS_CERT_PATH`; populated by `npm run issue-tls`    |

## API

When `NODE_ENV !== production`, interactive Swagger UI is at `http://localhost:8787/docs`.

| Method | Path                 | Auth   | Purpose                              |
| ------ | -------------------- | ------ | ------------------------------------ |
| `POST` | `/convert`           | Bearer | Start a conversion job (202 + jobId) |
| `GET`  | `/jobs/:id`          | Bearer | Job snapshot (polling)               |
| `GET`  | `/jobs/:id/events`   | Bearer | Server-Sent Events for progress      |
| `GET`  | `/jobs/:id/download` | Bearer | Stream the finished MP3              |
| `GET`  | `/health`            | Bearer | Uptime ping                          |

See [docs/architecture.md](docs/architecture.md) for the request lifecycle, job state machine, and security model.

## Production: TLS + auto-start

For day-to-day use you'll want the API to start on login (so the iPhone shortcut just works) and serve HTTPS (so iOS Safari is happy and PWA features unlock). Both are scripted.

### 1. Issue a TLS cert

Prerequisites: Tailscale running, you're logged in, and HTTPS certificates are enabled in the [admin console](https://login.tailscale.com/admin/dns) (`DNS → HTTPS Certificates`).

```sh
npm run issue-tls
```

This runs `tailscale cert` against your Mac's tailnet hostname and drops `.crt`/`.key` files into `.tls/` (gitignored). It prints the two env vars you need; paste them into `.env`. Re-run every ~90 days; Tailscale certs expire.

### 2. Install the launchd agent

```sh
npm run build           # produce api/dist/
npm run install-agent   # write ~/Library/LaunchAgents/com.yt-dlp-fork.api.plist + load it
```

The script reads `TLS_CERT_PATH` / `TLS_KEY_PATH` from `.env` and bakes them into the plist so HTTPS works without re-sourcing. Logs go to `~/Library/Logs/yt-dlp-fork/`.

To stop/uninstall:

```sh
npm run uninstall-agent
```

### Renewing the cert later

```sh
npm run issue-tls            # writes new cert/key on top of the old paths
launchctl kickstart -k gui/$(id -u)/com.yt-dlp-fork.api   # restart so node re-reads
```

## Optional: host the frontend separately

If you want to serve `web/` from a static host (Netlify, Cloudflare Pages, Vercel, S3, etc.) instead of the Mac, the SPA supports it out of the box. On first visit, the auth gate asks for an **API base URL** alongside the token; both are stored in `localStorage`. Every API call uses the stored base URL, so the frontend works from any origin.

The API needs two things to accept the cross-origin calls:

1. **HTTPS** — browsers block mixed content from an `https://` page to an `http://` API. `npm run issue-tls` gives you a Tailscale-issued cert.
2. **CORS allowlist** — set `CORS_ORIGINS` in `.env` to the frontend's origin (comma-separated if you have multiple).

```sh
# .env
CORS_ORIGINS=https://your-frontend-host.example.com
```

The API stays bearer-gated regardless of origin; nothing converts without the token, and nothing reaches the Mac without Tailscale.

## Troubleshooting

**`spawn yt-dlp ENOENT`** — yt-dlp isn't on `PATH`. Run `npm run check-deps`, then `brew install yt-dlp ffmpeg deno`.

**YouTube fails with "JS challenge"** — install `deno` (`brew install deno`). yt-dlp uses it for YouTube's player JS.

**Site stops working** — yt-dlp extractors break when sites change. Run `npm run update-ytdlp`.

**iPhone says "Server stopped working"** during a long conversion — Tailscale's MagicDNS is fine, but make sure your Mac isn't sleeping. `pmset -g` to inspect; in `System Settings → Battery → Options`, allow "Prevent automatic sleeping on power adapter when the display is off".

**Token gone after a week** — Safari's ITP cleared `localStorage`. Re-paste, or add the site to Home Screen (see above).

**Large file downloads fail on iOS** — Safari has historically struggled with blob downloads over ~50 MB. For MP3s (typically 3-10 MB per song) this is fine; if you're grabbing very long mixes, consider trimming the source.

## Layout

```
.
├── api/                  NestJS workspace
│   ├── src/              source
│   ├── test/             e2e tests
│   └── dist/             build output (gitignored)
├── web/                  static frontend (served by the API)
├── scripts/              dep-check + update-ytdlp shell scripts
├── docs/                 architecture
├── tmp/                  per-job temp dirs (gitignored, auto-cleaned)
└── .env                  AUTH_TOKEN etc. (gitignored)
```
