# CloudTask

A small multi-user task-management application built to exercise a realistic AWS
stack (VPC, ALB, ECS Fargate, RDS, ElastiCache, SQS, S3, Secrets Manager,
CloudWatch). See [`application-spec.md`](./application-spec.md) for the full
specification.

This repository contains the **application** (a pnpm + Turborepo monorepo) and
its local development setup. AWS is provisioned **manually** by following
[`aws-deployment-lab-runbook-manual.md`](./aws-deployment-lab-runbook-manual.md).
Terraform infrastructure-as-code is deferred to a later phase.

## Structure

```text
apps/
  web/        Next.js frontend (App Router)
  api/        NestJS HTTP API
  worker/     NestJS standalone SQS worker
packages/
  contracts/  Shared Zod schemas + types + env-config contracts
  eslint-config/
  tsconfig/
scripts/      Local helper scripts (LocalStack init)
```

## Prerequisites

- Node.js 24 (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable`)
- Docker + Docker Compose

## Getting started

```bash
corepack enable
nvm use            # Node 24
pnpm install       # installs the whole workspace
```

### Run the whole stack with Docker

```bash
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:3001 (health: http://localhost:3001/health)
- Postgres: localhost:5432 · Redis: localhost:6379 · LocalStack: localhost:4566

> The API/worker connect to Postgres, Redis (API only), and LocalStack (SQS/S3).
> Database migrations run automatically via a one-shot `migrate` service
> (added in Milestone 2).

### Workspace scripts

```bash
pnpm build         # turbo: build contracts, then apps
pnpm lint
pnpm typecheck
pnpm test
pnpm format
```

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to
`main`/`develop`: install (frozen lockfile), lint, type check, unit tests, build
all apps, API integration tests against Postgres + Redis service containers, and
a Trivy filesystem scan. `.github/workflows/release.yml` is the OIDC-based target
workflow that builds and pushes production images to ECR (dormant until the
`AWS_ROLE_ARN`/`AWS_REGION` repo variables are set).

## Production images

Each app ships a multi-stage Dockerfile with a `prod` target (non-root,
production dependencies only, compiled JS):

```bash
docker build --target prod -f apps/api/Dockerfile -t cloudtask-api .
docker build --target prod -f apps/worker/Dockerfile -t cloudtask-worker .
docker build --target prod \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://your-alb/api/v1 \
  -f apps/web/Dockerfile -t cloudtask-web .
```

## Deployment

The application reads all configuration from environment variables, so it runs
unchanged once the AWS resources exist — in AWS, `DATABASE_URL` and `JWT_SECRET`
are injected from the Secrets Manager secret `cloudtask/dev/application`.

Four runbooks deploy the same application on deliberately different
foundations, so they can be compared directly:

| Runbook | Method | What it teaches |
|---|---|---|
| [manual](./aws-deployment-lab-runbook-manual.md) | AWS Console, by hand | Every wire: subnets, route tables, SGs, target groups, listener rules |
| [terraform](./aws-deployment-lab-runbook-terraform.md) | Terraform modules | Declarative infrastructure, state, drift, plan/apply discipline |
| [ecs-express-mode](./aws-deployment-lab-runbook-ecs-express-mode.md) | AWS CLI + ECS Express Mode | Managed compute; hides the ALB, TLS, auto scaling, canary deploys |
| [beanstalk](./aws-deployment-lab-runbook-beanstalk.md) | EB CLI + Docker Compose | Platform-as-a-service; instance-hosted containers, enhanced health |

Start with the manual runbook — the two managed-compute runbooks are a fraction
of its length, and the point is seeing what they removed. The Elastic Beanstalk
deployment bundle lives in [`deploy/beanstalk/`](./deploy/beanstalk).

## Implementation roadmap

1. **Monorepo skeleton + local dev** ← current
2. API foundation + auth
3. Projects
4. Tasks + filters + summary cache
5. Exports (SQS + S3 + worker)
6. Frontend pages
7. PR CI + production Dockerfiles