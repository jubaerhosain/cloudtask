# Deviations from the specification

This file records intentional deviations from `application-spec.md` (per spec §26.13).

## Delivery / infrastructure

- **Terraform deferred.** `infrastructure/terraform/` is intentionally omitted in
  the current phase. AWS resources are provisioned manually via
  `aws-deployment-lab-runbook-manual.md`. Terraform will be added later. The
  application is env-var/adapter driven so it deploys unchanged once resources exist.
  (Agreed with the project owner.)

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
