# LibreNotebook — server-mode container.
#
# Multi-stage build:
#   1. `builder`  — runs `vite build`, compiles the static assets
#   2. `runtime`  — slim Deno image with the built _fresh/ tree + project
#
# We ship Deno itself as the runtime rather than the deno-compile binary
# because in-image disk space is cheap and `deno serve` keeps the same
# request handling as `_fresh/server.js` is built for.

ARG DENO_VERSION=latest

# --- stage 1: build ---
FROM denoland/deno:${DENO_VERSION} AS builder

WORKDIR /app

# Copy dependency manifests first for caching.
COPY deno.json deno.lock ./
COPY vite.config.ts ./
COPY tsconfig.json* ./
RUN deno cache --node-modules-dir=auto deno.json 2>/dev/null || true

# Copy source.
COPY src ./src
COPY static ./static
COPY resources ./resources

# Vite build → _fresh/server.js + _fresh/static/*
RUN deno task build

# --- stage 2: runtime ---
FROM denoland/deno:${DENO_VERSION} AS runtime

# yt-dlp is shipped via apt so YouTube ingest works out of the box.
USER root
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        yt-dlp \
        librsvg2-bin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/_fresh         ./_fresh
COPY --from=builder /app/src            ./src
COPY --from=builder /app/static         ./static
COPY --from=builder /app/resources      ./resources
COPY --from=builder /app/deno.json      ./deno.json
COPY --from=builder /app/deno.lock      ./deno.lock
COPY --from=builder /app/node_modules   ./node_modules

# Persist user data outside the image.
ENV LIBRENOTEBOOK_DATA_DIR=/data
ENV PORT=5173
ENV HOST=0.0.0.0
ENV LOG_LEVEL=INFO
ENV LOG_FILE=1
RUN mkdir -p /data && chown -R deno:deno /data /app

USER deno

EXPOSE 5173
VOLUME ["/data"]

# Use the same entry the .deb / AppImage use so the binary boots
# `deno serve _fresh/server.js`-equivalent semantics.
CMD ["deno", "serve", "--allow-all", "--host", "0.0.0.0", "--port", "5173", "_fresh/server.js"]
