# ═══════════════════════════════════════════════════════════
#  Orbit Advancement — Production Dockerfile
#  Multi-stage: build → production (minimal image)
#  Security: non-root user, no dev deps, read-only filesystem
# ═══════════════════════════════════════════════════════════

# ── Stage 1: Install dependencies ─────────────────────────
FROM node:20-alpine AS deps

# Install security patches
RUN apk update && apk upgrade --no-cache

WORKDIR /app

# Copy only package files first (layer cache optimization)
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force

# ── Stage 2: Production image ──────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root
RUN addgroup -g 1001 -S orbit && adduser -S orbit -u 1001 -G orbit

# Install runtime-only system deps (tini for proper PID 1 handling)
RUN apk add --no-cache tini dumb-init

WORKDIR /app

# Copy deps from build stage
COPY --from=deps --chown=orbit:orbit /app/node_modules ./node_modules

# Copy source
COPY --chown=orbit:orbit src/ ./src/
COPY --chown=orbit:orbit package.json ./

# Create logs dir
RUN mkdir -p /app/logs && chown orbit:orbit /app/logs

# Switch to non-root
USER orbit

# Expose API port
EXPOSE 3001

# Health check (used by docker-compose, k8s, ECS)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Use tini as PID 1 (proper signal handling, no zombie processes)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
