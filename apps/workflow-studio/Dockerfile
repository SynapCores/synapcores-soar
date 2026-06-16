# syntax=docker/dockerfile:1
# SynapCores Workflow Studio — multi-stage Next.js 15 Dockerfile
# Port: 3010

# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace manifests so pnpm can resolve workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/workflow-studio/package.json ./apps/workflow-studio/

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm --filter @synapcores/workflow-studio build

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3010
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy built output
COPY --from=builder /app/apps/workflow-studio/public         ./public        2>/dev/null || true
COPY --from=builder --chown=nextjs:nodejs \
     /app/apps/workflow-studio/.next/standalone              ./
COPY --from=builder --chown=nextjs:nodejs \
     /app/apps/workflow-studio/.next/static                  ./.next/static

USER nextjs

EXPOSE 3010

CMD ["node", "apps/workflow-studio/server.js"]
