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
EXPOSE 3000
CMD ["pnpm", "--filter", "@cloudtask/web", "dev"]

FROM deps AS build
# NEXT_PUBLIC_* is inlined at build time, so the API base URL must be provided
# as a build argument (the ALB URL in AWS).
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY . .
RUN pnpm --filter @cloudtask/contracts build \
  && pnpm --filter @cloudtask/web build

# ---------------------------------------------------------------------------
# prod: Next.js standalone output (minimal server + traced node_modules).
# ---------------------------------------------------------------------------
FROM base AS prod
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
