# syntax=docker/dockerfile:1.7

# Multi-stage build for yt-dlp-fork.
# Stage 1 compiles the Nest app with full devDependencies.
# Stage 2 is a slim runtime with yt-dlp, ffmpeg, and deno installed
# alongside the built dist + pruned node_modules.

############################
# Stage 1: build
############################
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Husky's `prepare` script would try to install git hooks; we don't ship
# .git into the image, so disable it.
ENV HUSKY=0
ENV CI=true

# Install workspace deps with devDependencies for the build.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
RUN npm ci

# Copy source and build.
COPY api ./api
RUN npm run build

# Strip devDependencies from the resulting node_modules tree.
RUN npm prune --omit=dev

############################
# Stage 2: runtime
############################
FROM node:22-bookworm-slim AS runtime

# Install yt-dlp (standalone binary), ffmpeg (apt), deno (binary download).
# Layer keeps install + cleanup in one RUN to avoid baking apt cache.
RUN set -eux \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg \
       ca-certificates \
       curl \
       unzip \
  && curl -fsSL -o /usr/local/bin/yt-dlp \
       https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && curl -fsSL -o /tmp/deno.zip \
       https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip \
  && unzip /tmp/deno.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/deno \
  && rm /tmp/deno.zip \
  && yt-dlp --version \
  && deno --version \
  && ffmpeg -version | head -n1 \
  && apt-get purge -y curl unzip \
  && apt-get autoremove -y \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV TMP_DIR=/tmp/yt-dlp-fork
ENV PORT=8787

# Copy built artifacts + pruned deps + static frontend.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/api/package.json ./api/package.json
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/web ./web

# Render mounts an ephemeral filesystem; making the dir explicit so it's
# present at boot and visible under `docker exec`.
RUN mkdir -p /tmp/yt-dlp-fork

EXPOSE 8787

# Render injects PORT; we still default to 8787 above so local `docker run`
# works without setting it.
CMD ["node", "api/dist/main.js"]
