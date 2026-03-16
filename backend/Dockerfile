# ═══════════════════════════════════════════════════════════════════════════
#  Orbit Advancement — Production Dockerfile
#  Multi-stage: deps → build (TypeScript compile) → production (minimal image)
#  Security: non-root user, no dev deps, compiled JS only
# ═══════════════════════════════════════════════════════════════════════════

# ── Stage 1: Install ALL deps (including dev) for building ─────────────────
FROM node:20-alpine AS deps

RUN apk update && apk upgrade --no-cache

WORKDIR /app

COPY package.json package-lock.json* ./

# Install all deps (dev needed for tsc)
RUN npm ci --ignore-scripts && npm cache clean --force

# ── Stage 2: Compile TypeScript ────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copy deps + source
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src/ ./src/

# Compile — output to dist/
RUN node_modules/.bin/tsc --build

# ── Stage 3: Production image ──────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root
RUN addgroup -g 1001 -S orbit && adduser -S orbit -u 1001 -G orbit

# Runtime system deps (tini for proper PID 1 signal handling)
RUN apk add --no-cache tini

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output from build stage
COPY --from=build --chown=orbit:orbit /app/dist ./dist

# Create logs dir
RUN mkdir -p /app/logs && chown orbit:orbit /app/logs

USER orbit

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Use tini as PID 1 (proper signal handling, no zombie processes)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
