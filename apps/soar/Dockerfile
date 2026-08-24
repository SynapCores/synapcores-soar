# syntax=docker/dockerfile:1
#
# SynapCores SOAR — production app image.
#
# Build context is the REPO ROOT (pnpm workspace; the app depends on
# @synapcores/app-framework via workspace:*):
#
#   docker build -f apps/soar/Dockerfile -t ghcr.io/synapcores/soar:dev .
#
# Replaces the previous compose arrangement, which mounted the source tree
# into stock node:22-alpine, ran `pnpm install` at container start, and then
# served `next dev` — i.e. an unoptimised development server, with a
# multi-minute first boot, as the production entrypoint.

# ---------- deps: resolve the workspace once, cached on the lockfile ----------
FROM node:22-slim AS deps
# pnpm 9 deliberately: pnpm 10+ blocks dependency build scripts by default and
# exits non-zero (ERR_PNPM_IGNORED_BUILDS for esbuild/sharp), which `next build`
# needs to succeed.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
# Only manifests here, so this layer is reused whenever sources change but
# dependencies do not.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/app-framework/package.json packages/app-framework/
COPY apps/soar/package.json apps/soar/
COPY apps/aml/package.json apps/aml/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build
COPY . .
# NODE_ENV stays unset: devDependencies (typescript, tailwind) are required
# for the build itself.
RUN pnpm --filter @synapcores/soar build

# ---------- runtime ----------
FROM node:22-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001
WORKDIR /app

# curl is used by the container healthcheck below.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Next's standalone bundle carries its own traced node_modules.
COPY --from=build /app/apps/soar/.next/standalone ./
COPY --from=build /app/apps/soar/.next/static ./apps/soar/.next/static
# (this app ships no public/ directory; nothing to copy)

# Bootstrap runs at container start (it needs a live engine), so the schema
# files and the two .mjs scripts must exist in the runtime image. Both scripts
# import only node: builtins, so they need nothing from node_modules.
COPY --from=build /app/apps/soar/bin ./apps/soar/bin
COPY --from=build /app/apps/soar/src/lib/*.sql ./apps/soar/src/lib/
COPY --from=build /app/packages/app-framework/bin ./packages/app-framework/bin
COPY --from=build /app/packages/app-framework/src/db/*.sql ./packages/app-framework/src/db/

COPY apps/soar/bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run unprivileged. node:22-slim already ships uid/gid 1000 as `node`.
USER node

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=4s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
