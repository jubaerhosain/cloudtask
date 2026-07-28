# Deviations from the specification

This file records intentional deviations from `application-spec.md` (per spec §26.13).

## Delivery / infrastructure

- **Terraform delivered (was: deferred).** `infrastructure/terraform/` now exists
  (bootstrap + 13 modules + `environments/dev`), superseding the earlier deferral.
  Implementation notes that deviate from or refine the spec:
  - **`rds.force_ssl = 0`** via a custom PG16 parameter group. The app's TypeORM
    data source sets no `ssl` option, and the Postgres 16 default parameter group
    forces TLS, which would reject every connection. Disabling force_ssl needs
    zero app changes; DB traffic never leaves the private-data subnets.
  - **Log groups are `/ecs/cloudtask-dev-<app>`** (not `/cloudtask/dev/<app>`) —
    shared naming contract with the release workflow's migration log tailing.
  - **ECS services ignore `task_definition` and `desired_count` drift.** CI
    registers image-swapped task-definition revisions and scales services from
    the bootstrap `desired_count = 0` to 1; Terraform must never revert either.
  - **No `ExpiresOn` tag.** The spec's tagging scheme includes an ExpiresOn
    date (§ Tagging); the `expires_on` variable and tag were removed as noise —
    teardown is manual and tracked outside tags.
  - **Deploy role is console-managed.** Every local Terraform run (provider and
    S3 backend) assumes `cloudtask-terraform-deploy`, an AdministratorAccess
    role created manually in the console whose trust policy allows the owner's
    IAM user — it lives outside every stack, so no Terraform state tracks it.
  - **Account-specific values stay out of git.** The deploy role ARN and state
    bucket name (both embed the account ID) live only in the gitignored
    `terraform.tfvars` and `backend.hcl` (partial backend config, passed via
    `terraform init -backend-config=backend.hcl`). `backend.hcl.example` is an
    addition to the spec's `environments/dev` file tree (§ Terraform layout).
  - **Secret values live in Terraform state** (encrypted S3): Terraform composes
    `DATABASE_URL` and generates `JWT_SECRET`/DB password. Accepted for the lab.

- **Node 24 / LocalStack `:3`.** The spec predates the current toolchain. We target
  Node 24 LTS (installed) and pin the LocalStack community image `localstack/localstack:3`
  because the rolling `latest`/calendar tags are now license-gated.

## API additions (beyond the literal spec)

- **`GET /api/v1/auth/me`.** Added a small authenticated endpoint returning the
  current user's public profile. It is not enumerated in spec §6.1 but is a natural
  part of an auth slice and lets the JWT guard be verified end-to-end. Protected by
  the global JWT guard.

## Known library incompatibility

- **Swagger + nestjs-zod.** `nestjs-zod@4.3.1`'s `patchNestJsSwagger()` imports a
  `@nestjs/swagger` v11 internal (`dist/services/schema-object-factory`) that no
  longer exists, crashing bootstrap. The patch is not used. Swagger `/docs` still
  documents all routes; zod DTO request bodies render without a detailed schema.
  Revisit if nestjs-zod ships a v11-compatible patch.

## Local-only limitations

- **Export download URL in local dev.** The presigned S3 URL is signed for the
  LocalStack endpoint host (`localstack:4566`), which resolves inside the Docker
  network but not from a host browser. In real AWS the URL is a public S3 URL and
  works directly. The frontend renders the download link and the E2E test asserts
  it appears; fetching the object from a host browser locally is out of scope.

## Resolved ambiguities (documented, not true deviations)

- **DTO validation** uses `nestjs-zod` (`createZodDto` + global `ZodValidationPipe`)
  reusing the shared `@cloudtask/contracts` schemas, rather than class-validator, to
  keep a single source of truth across API and frontend.
- **Health checks** are hand-rolled (not `@nestjs/terminus`) so `/ready` can report
  Redis as `degraded` (non-fatal) while Postgres failure is fatal (503), per spec §9.
- **Cross-user access returns 404** (not 403) to avoid resource-existence enumeration.
- **JWT guard is global** with an opt-out `@Public()` decorator (secure by default).
- **Rate limiting** uses a fixed-window counter (atomic Redis Lua) with a per-task
  in-memory fallback; the fallback is intentionally per-process (spec §6.6 permits a
  conservative single-task fallback).
- **`x-request-id`** is accepted only if it matches `^[A-Za-z0-9._-]{1,128}$`
  (guards against header/log injection); otherwise a UUID is generated.
