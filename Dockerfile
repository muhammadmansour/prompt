# syntax=docker/dockerfile:1.7
# ============================================================
# Wathbah GRC-Admin — production image
#
# Multi-stage:
#   1) builder  — compiles native deps (better-sqlite3 → node-gyp)
#   2) runtime  — slim image, non-root user, no build toolchain
# ============================================================

ARG NODE_VERSION=20.18.1

# ---------- Stage 1: builder ----------
FROM node:${NODE_VERSION}-bookworm AS builder

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Build toolchain for native modules (better-sqlite3).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Leverage Docker layer caching: only reinstall deps when lockfile changes.
COPY package.json package-lock.json* ./

# `npm ci` gives reproducible installs; --omit=dev drops devDependencies.
RUN npm ci --omit=dev \
 && npm cache clean --force

# ---------- Stage 2: runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5555 \
    TZ=Asia/Riyadh \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# tini for proper PID 1 signal handling; tzdata so logs / trial IDs align with
# the KSA timezone that the scraper already pins via Intl.DateTimeFormat.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tini \
      tzdata \
      ca-certificates \
      wget \
 && rm -rf /var/lib/apt/lists/* \
 && ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
 && echo "${TZ}" > /etc/timezone

# Non-root runtime user (the base image already ships a `node` user).
WORKDIR /app

# /app/data is the single persistent volume mount point. The entrypoint
# symlinks all mutable paths into it.
RUN mkdir -p /app/data && chown -R node:node /app

# Copy installed deps from the builder stage (includes the compiled
# better-sqlite3 binary). Keeps the final image free of python/g++.
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copy application source. Anything listed in .dockerignore is skipped.
COPY --chown=node:node . .

# Ensure the entrypoint is executable even if git didn't preserve the bit
# (e.g. when cloning on Windows).
RUN chmod +x /app/docker-entrypoint.sh

USER node

ENV DATA_DIR=/app/data

VOLUME ["/app/data"]

EXPOSE 5555

# Simple HTTP healthcheck. The static root returns the admin SPA; a 200/3xx
# on `/` means the server process is alive and serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null --tries=1 --timeout=4 "http://127.0.0.1:${PORT}/" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
