# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Base: Node 24 (Debian slim, glibc) + pnpm via corepack.
# Debian (not Alpine) so native modules like argon2 use prebuilt glibc binaries.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install the full monorepo. Build context is the repo ROOT.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# dev: source is bind-mounted by docker-compose; contracts is prebuilt so the
# API can import @cloudtask/contracts. `nest start --watch` gives hot reload.
# ---------------------------------------------------------------------------
FROM deps AS dev
COPY . .
RUN pnpm --filter @cloudtask/contracts build
EXPOSE 3000
CMD ["pnpm", "--filter", "@cloudtask/api", "start:dev"]

# ---------------------------------------------------------------------------
# build: compile contracts + API, then produce a pruned production deployment
# (app files + production-only node_modules) under /prod.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @cloudtask/contracts build \
  && pnpm --filter @cloudtask/api build \
  && pnpm --filter @cloudtask/api deploy --legacy --prod /prod

# ---------------------------------------------------------------------------
# prod: minimal runtime image, non-root, compiled JS only.
# ---------------------------------------------------------------------------
FROM base AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
