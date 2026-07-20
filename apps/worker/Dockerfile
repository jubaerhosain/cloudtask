# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
RUN pnpm --filter @cloudtask/contracts build
CMD ["pnpm", "--filter", "@cloudtask/worker", "start:dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter @cloudtask/contracts build \
  && pnpm --filter @cloudtask/worker build \
  && pnpm --filter @cloudtask/worker deploy --legacy --prod /prod

FROM base AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod ./
USER node
# The worker has no HTTP port; graceful SIGTERM handled in main.ts.
CMD ["node", "dist/main.js"]
