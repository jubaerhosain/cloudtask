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
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# ---------------------------------------------------------------------------
# dev: source is bind-mounted by docker-compose; contracts is prebuilt so the
# API can import @cloudtask/contracts. `nest start --watch` gives hot reload.
# ---------------------------------------------------------------------------
FROM deps AS dev
COPY . .
RUN pnpm --filter @cloudtask/contracts build
EXPOSE 3000
CMD ["pnpm", "--filter", "@cloudtask/api", "start:dev"]
