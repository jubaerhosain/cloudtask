# CloudTask

A small multi-user task-management application built to exercise a realistic AWS
stack (VPC, ALB, ECS Fargate, RDS, ElastiCache, SQS, S3, Secrets Manager,
CloudWatch). See [`application-spec.md`](./application-spec.md) for the full
specification.

This repository contains the **application** (a pnpm + Turborepo monorepo), its
local development setup, and the **Terraform infrastructure** under
[`infrastructure/terraform/`](./infrastructure/terraform/) (see
[Deployment](#deployment)). The manual console path is still documented in
[`aws-deployment-lab-runbook-manual.md`](./aws-deployment-lab-runbook-manual.md).

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
scripts/      Local helper scripts (LocalStack init, AWS teardown)
infrastructure/
  terraform/  IaC: bootstrap (state backend), modules, environments/dev
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

- Web: http://localhost:3000 (health: http://localhost:3000/healthz)
- API: http://localhost:3001 (health: http://localhost:3001/health, readiness: http://localhost:3001/ready)
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
all apps, API integration tests against Postgres + Redis service containers,
`terraform fmt`/`validate`, and a Trivy filesystem scan.

`.github/workflows/release.yml` is the OIDC-based release pipeline (dormant
until the `AWS_ROLE_ARN`/`AWS_REGION`/`NEXT_PUBLIC_API_BASE_URL` repo variables
are set). On every push to `main` it builds and pushes Git-SHA-tagged production
images to ECR, runs DB migrations as a one-shot ECS task, rolls the three ECS
services (ECS deployment circuit breaker rolls back on failure, and the workflow
fails red if that happens), and smoke-tests `/health`, `/ready`, and the web
root through the ALB.

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

> New to Terraform? Start with
> [`infrastructure/terraform/docs/`](./infrastructure/terraform/docs/README.md) — a
> beginner-oriented guide to this stack: an HCL primer, architecture diagrams, a file-by-file
> walkthrough, per-module rationale, and an operations runbook.

Infrastructure is Terraform-managed under `infrastructure/terraform/`
(production-shaped: VPC with private subnets + NAT, ALB, ECS Fargate, RDS
Postgres 16, ElastiCache Redis 7 with TLS, SQS + DLQ, S3, Secrets Manager,
CloudWatch dashboard/alarms — smallest instance sizes). The application reads
all configuration from environment variables; in AWS, `DATABASE_URL` and
`JWT_SECRET` are injected from the Secrets Manager secret
`cloudtask/dev/application`.

**Terraform runs locally** (state in S3 with native S3 lockfile locking); CI
never applies. Every Terraform run assumes the console-managed IAM role
`cloudtask-terraform-deploy` (its trust policy allows the owner's IAM user, so
the user credentials only need `sts:AssumeRole`). Account-specific values stay
out of git: the role ARN goes in the gitignored `terraform.tfvars` (provider)
and `backend.hcl` (state backend), both copied from their `.example` files in
`environments/dev/`. Bootstrap, in order:

```bash
# 1. State backend (local state; creates the S3 state bucket)
cd infrastructure/terraform/bootstrap
terraform init && terraform apply   # prompts for deploy_role_arn
terraform output state_bucket_name  # put into ../environments/dev/backend.hcl

# 2. The environment (services start at desired_count 0)
cd ../environments/dev
cp terraform.tfvars.example terraform.tfvars   # set deploy_role_arn etc.
cp backend.hcl.example backend.hcl             # set bucket + role ARN
terraform init -backend-config=backend.hcl && terraform apply

# 3. Wire up CI (un-gates the Release workflow)
gh variable set AWS_ROLE_ARN  --body "$(terraform output -raw github_ci_role_arn)"
gh variable set AWS_REGION    --body "ap-south-1"
gh variable set NEXT_PUBLIC_API_BASE_URL \
  --body "http://$(terraform output -raw alb_dns_name)/api/v1"

# 4. First deploy: push to main or run the Release workflow manually
gh workflow run Release --ref main
```

The first Release run builds images (the web image bakes in the ALB URL), runs
migrations, scales services from 0 to 1, and smoke-tests through the ALB. Every
later merge to `main` deploys automatically; `terraform apply` never touches
task definitions or scaling (`ignore_changes`).

Tear down with [`scripts/aws-teardown.sh`](./scripts/aws-teardown.sh) — it runs
`terraform destroy` and then verifies (12 checks) that nothing is left billing.

> Note: the RDS master password and secret values appear in the Terraform state
> file (encrypted, versioned, private S3 bucket — never in git). Acceptable for
> this lab; use externally-managed secrets if that ever changes.

## Implementation roadmap

1. **Monorepo skeleton + local dev** ← current
2. API foundation + auth
3. Projects
4. Tasks + filters + summary cache
5. Exports (SQS + S3 + worker)
6. Frontend pages
7. PR CI + production Dockerfiles
