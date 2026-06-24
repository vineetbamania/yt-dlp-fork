# Deployment

This app is a **persistent process** that spawns `yt-dlp` + `ffmpeg`, holds job
state in memory, and streams progress. It is **not** serverless-friendly. Host
it on something that runs a long-lived container or VM.

Three supported targets, cheapest-effort first:

| Target                  | Cost           | Cold start            | Effort | Notes                                  |
| ----------------------- | -------------- | --------------------- | ------ | -------------------------------------- |
| **Fly.io** (this guide) | ~$0–5/mo       | ~1–2s (scale-to-zero) | Low    | Deploys the repo `Dockerfile` directly |
| **Render**              | $0 (free plan) | ~30–60s               | Lowest | Already wired via `render.yaml`        |
| **Hetzner / any VPS**   | €3.79+/mo      | none                  | Higher | You manage Docker, TLS, firewall       |

> ⚠️ **Datacenter-IP reality.** JioSaavn, Gaana and SoundCloud download fine from
> any cloud. **YouTube — and Spotify, which re-sources audio from YouTube — get
> bot-challenged from datacenter IPs.** To make them work from the cloud you must
> supply a YouTube **cookies file** (see [Cookies](#youtube--spotify-cookies)).

---

## Fly.io (recommended)

### Prerequisites

- A Fly.io account and `flyctl` installed: `brew install flyctl`, then `fly auth login`.
- The repo's `Dockerfile` and `fly.toml` (already present).

### 1. Create the app

```bash
cd /path/to/yt-dlp-fork
# Edit fly.toml: set a unique `app` name and your nearest `primary_region`
#   (e.g. "bom" = Mumbai, "sin" = Singapore, "fra", "lhr", "iad").
fly launch --no-deploy --copy-config --name <your-app-name>
```

`--no-deploy` lets us set secrets before the first boot (the app refuses to start
without `AUTH_TOKEN`).

### 2. Set secrets

```bash
# Strong bearer token (the only thing gating the public URL):
fly secrets set AUTH_TOKEN="$(openssl rand -hex 32)"

# (Optional, for YouTube/Spotify) base64 of your cookies.txt — see Cookies below:
fly secrets set YTDLP_COOKIES_B64="$(base64 -i cookies.txt | tr -d '\n')"
```

Secrets are encrypted and injected as env vars at runtime; they are never in the
image or the repo.

### 3. Deploy

```bash
fly deploy
```

Fly builds the `Dockerfile`, boots a machine, and waits for `/healthz` to pass.

### 4. Verify

```bash
APP=https://<your-app-name>.fly.dev
curl -s $APP/healthz                       # -> {"status":"ok"}  (public)
TOKEN=<the AUTH_TOKEN you set>

# JioSaavn smoke test (works without cookies):
JOB=$(curl -s -X POST $APP/convert \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI"}' | jq -r .jobId)
curl -s $APP/jobs/$JOB -H "Authorization: Bearer $TOKEN" | jq '{status,title}'
curl -s $APP/jobs/$JOB/download -H "Authorization: Bearer $TOKEN" -o test.mp3
```

The web UI is also live at `$APP/` — paste the token + an API base URL of `$APP`.

### Cost / scaling

- `fly.toml` ships with `min_machines_running = 0` (scale-to-zero) — you pay only
  while converting; cold start is ~1–2s. For **always-on**, set it to `1`.
- `shared-cpu-1x` / 512MB is plenty for single-user. Bump `memory` to `1024` only
  if large playlists OOM.

---

## YouTube / Spotify cookies

YouTube blocks datacenter IPs with "Sign in to confirm you're not a bot." yt-dlp
gets past this with cookies from a logged-in browser session.

### Export cookies.txt

1. In your browser (logged into YouTube), install a Netscape-format cookie
   exporter such as the **"Get cookies.txt LOCALLY"** extension.
2. Go to `https://www.youtube.com`, export, and save as `cookies.txt`.
   - Prefer exporting from a **throwaway/secondary Google account** — these
     cookies grant access to that account.

### Provide them to the server

- **Fly.io:** `fly secrets set YTDLP_COOKIES_B64="$(base64 -i cookies.txt | tr -d '\n')"`.
  The app decodes it to a file at boot (see `resolveCookiesPath` in
  `api/src/convert/ytdlp.service.ts`).
- **VM / local:** put the file somewhere readable and set
  `YTDLP_COOKIES_FILE=/path/to/cookies.txt`.

Cookies expire — if YouTube starts failing again, re-export and re-set the secret.

> Note: cookies only affect the yt-dlp path (YouTube, SoundCloud, and Spotify's
> YouTube-sourced audio). JioSaavn/Gaana ignore them entirely.

---

## Render (free, already configured)

`render.yaml` is committed and set to the free Docker plan.

1. In the Render dashboard: **New → Blueprint**, point it at this repo.
2. Set `AUTH_TOKEN` (and optionally `YTDLP_COOKIES_B64`) as env vars in the
   dashboard — `render.yaml` marks `AUTH_TOKEN` as `sync: false`.
3. Push to `main` → Render auto-deploys (`autoDeployTrigger: commit`).

Caveat: the free plan **sleeps after ~15 min idle**, so the first request after a
nap takes ~30–60s. Fine for personal use; upgrade to a paid instance to avoid it.

---

## Hetzner / generic VPS (full control)

For an always-on box with no cold start and a cleaner IP:

```bash
# On a fresh Debian/Ubuntu VPS (e.g. Hetzner CX22, €3.79/mo):
curl -fsSL https://get.docker.com | sh

git clone https://github.com/vineetbamania/yt-dlp-fork.git
cd yt-dlp-fork
docker build -t yt-dlp-fork .

docker run -d --name yt-dlp-fork --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -e AUTH_TOKEN="$(openssl rand -hex 32)" \
  -e YTDLP_COOKIES_B64="$(base64 -i cookies.txt | tr -d '\n')" \
  yt-dlp-fork
```

Then put **Caddy** or **nginx** in front for automatic HTTPS (e.g. Caddy needs a
two-line `Caddyfile`: `your.domain { reverse_proxy localhost:8787 }`). Lock the
firewall to ports 80/443 only. Keep `yt-dlp` current by rebuilding periodically
(the image pulls the latest `yt-dlp_linux` at build time).

---

## Security note (any public host)

Moving off Tailscale means the bearer token is the **only** gate. Use a 32-byte
random `AUTH_TOKEN`, keep the built-in rate limiter on, and never expose Swagger
in production (it's already dev-only). The URL validator blocks private/loopback
hosts to refuse SSRF-shaped input.
