# Architecture

A personal, single-user, sideloaded MP3 grabber. The whole system is one Node process on a Mac, reachable from your iPhone over Tailscale.

## Topology

```
iPhone (Safari, Tailscale)
        |
        |  bearer-auth'd HTTPS over Tailscale
        v
+---------------------------+
|   NestJS API @ :8787      |   <- Node 22 LTS, single process
|                           |
|   - static  ../web/       |   <- ServeStaticModule
|   - /convert              |   <- ConvertModule
|   - /jobs/:id/events SSE  |
|   - /jobs/:id/download    |
|                           |
|        spawn(...)         |
+------------+--------------+
             |
             v
+---------------------------+
|   yt-dlp + ffmpeg + deno  |   <- external CLIs, brew-installed
+---------------------------+
```

## Module layout

```
src/
  main.ts            bootstrap, helmet, swagger (dev), pino, long-lived sockets
  app.module.ts      pino, throttler, static, filter, all feature modules
  config/            zod env schema; fails to boot on bad env
  auth/              BearerAuthGuard (timingSafeEqual) registered as APP_GUARD
  common/
    errors/          DomainError + UnsupportedUrlError + JobNotFoundError + ...
    filters/         AllExceptionsFilter -> consistent {statusCode,code,message,...}
    temp-dir.service.ts   mkdtemp + safe cleanup confined to TMP_DIR
  health/            GET /health
  convert/
    convert.controller.ts   POST /convert, SSE /jobs/:id/events, GET /jobs/:id, /download
    jobs.service.ts         in-memory Map<id, Job>, per-job ReplaySubject
    ytdlp.service.ts        spawn wrapper, line-buffered stderr parsing
    ytdlp-progress.parser.ts  stateless line parser (testable)
    url-validator.ts        scheme + private-host blocklist
    dto/                    zod schemas for request + response DTOs
    types.ts                Job, JobEvent, JobSnapshot
```

## Request lifecycle

```
client                          server                       yt-dlp
  |                                |                            |
  | POST /convert {url}            |                            |
  |------------------------------->| validateUrl()              |
  |                                | jobs.create()              |
  |                                | spawn yt-dlp (fire-forget) |--------->
  |<--------- 202 {jobId,...} -----|                            |
  |                                |                            |
  | GET /jobs/:id/events           |                            |
  |     (Accept: text/event-stream)|                            |
  |------------------------------->| subscribe to events$       |
  |<- event: state {queued}     ---|                            |
  |<- event: state {running}    ---|                            |
  |<- event: progress {pct,...} ---|<--- parsed stderr ---------|
  |<- event: progress           ---|<--- parsed stderr ---------|
  |                                |                            |   exit 0
  |                                |  markDone(filePath)        |<---------
  |<- event: done {downloadUrl} ---|  events$.complete()        |
  |     (connection closes)        |                            |
  |                                |                            |
  | GET /jobs/:id/download         |                            |
  |------------------------------->| stream file                |
  |<-------- audio/mpeg ----------|                            |
  |     (close) -----------------> | cleanup tempDir, delete job|
```

## Job state machine

```
                       updateProgress()
                        +----------+
                        |          v
queued --markRunning--> running --markDone--> done --(downloaded OR 10min)--> deleted
                            |
                            +--markFailed--> failed --(10min)--> deleted
```

State is held only in process memory. Restart = lose in-flight jobs. Acceptable for single-user.

## SSE protocol

Each event has a `type` and a JSON `data` payload:

| `type`     | `data` shape                             | When                                   |
| ---------- | ---------------------------------------- | -------------------------------------- |
| `state`    | full `JobSnapshot`                       | on creation, transition, and title set |
| `progress` | `{stage, percent?, eta?, speed?, size?}` | every yt-dlp progress tick             |
| `done`     | `{downloadUrl, fileName, title?}`        | terminal success; stream closes        |
| `failed`   | `{code, message}`                        | terminal failure; stream closes        |

The `ReplaySubject` keeps the last 50 events, so a reconnecting client gets recent history (including the terminal event if the job already finished).

## Security model

- **Network perimeter:** Tailscale. The API never listens on a public interface.
- **Auth:** single bearer token from `.env`. Compared in constant time (`crypto.timingSafeEqual`). Registered as `APP_GUARD` so every controller route is gated by default.
- **URL validation:** zod (scheme + length) + a host-blocklist (loopback, private RFC 1918, link-local, IPv6 unique-local) to refuse SSRF-shaped inputs even though yt-dlp doesn't fetch arbitrary URLs.
- **Process boundary:** yt-dlp is invoked via `spawn(cmd, args[])` — never via a shell. The URL goes as an `argv` element, not concatenated.
- **Filename safety:** yt-dlp's `--restrict-filenames` keeps output ASCII; downloaded filenames are also stripped of `\r\n"\\` before the `Content-Disposition` header.
- **Static asset auth:** Swagger UI is dev-only because its routes bypass `APP_GUARD`. Static `web/` is served public on purpose (it's the frontend) — every API call from it is still bearer-gated.

## File cleanup

Each job gets `mkdtemp(TMP_DIR/job-<uuid>-XXXX/)`. After the file is downloaded **or** 10 minutes pass without a download, the temp dir is `rm -rf`'d. The cleanup helper refuses to touch any path outside `TMP_DIR` as a guardrail.

## What's intentionally absent

- No database, no Redis, no job queue, no worker pool.
- No retries, no priority, no concurrency limits (Tailscale-only single user).
- No build pipeline for the frontend (vanilla HTML/CSS/JS + ES module).
- No multi-tenant auth — one static token does the whole job.
