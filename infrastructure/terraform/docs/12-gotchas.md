# 12 — Gotchas

**What you'll learn:** the deliberate deviations in this stack (and the reasoning behind each),
the lab compromises you'd invert in production, and two rough edges worth knowing about.

Nothing here is a bug report. It's the list of things that will look wrong until you know why.

---

## Deliberate deviations

All of these are recorded in [`DEVIATIONS.md`](../../../DEVIATIONS.md), which is the
authoritative source. Restated here in beginner terms.

### 1. `rds.force_ssl = 0` — TLS to the database is off

```hcl
# modules/rds/main.tf:14
resource "aws_db_parameter_group" "this" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }
}
```

Postgres 16's default RDS parameter group sets `rds.force_ssl = 1`, which rejects any
connection that doesn't negotiate TLS. The app's TypeORM data source
(`apps/api/src/database/data-source.options.ts`) sets no `ssl` option, so every connection
would be refused.

**The reasoning:** disabling it needs zero application changes, and the traffic never leaves
the private-data subnets, which have no internet route at all.

**What production should do instead:** configure `ssl` in the TypeORM data source (ideally
bundling the RDS CA and verifying properly) and leave `force_ssl = 1`. Defence in depth means
not relying on a single control.

### 2. Log groups are `/ecs/cloudtask-dev-<app>`, not `/cloudtask/dev/<app>`

The spec asks for `/cloudtask/dev/api`. The code uses `/ecs/cloudtask-dev-api`. The reason is
a naming contract: `release.yml`'s migration job tails logs with
`aws logs tail /ecs/cloudtask-dev-api`, and the `/ecs/<service>` convention is the ECS default
that most tooling expects. Rename it in Terraform and the release workflow's log tailing
breaks.

### 3. ECS services ignore `task_definition` and `desired_count`

```hcl
# modules/ecs-service/main.tf:100
lifecycle {
  ignore_changes = [task_definition, desired_count]
}
```

The single most important thing to understand about this stack. Terraform creates each service
once with a placeholder image and zero tasks; GitHub Actions then owns both attributes forever.
Remove this block and the next `terraform apply` reverts your running services to the
`bootstrap` image and scales them to zero.

Covered fully in [03 §5](./03-architecture-overview.md#5-who-owns-what-terraform-vs-ci).

### 4. No `ExpiresOn` tag

The spec's tagging scheme includes an expiry date. It was dropped as noise — teardown is manual
and tracked outside tags. What remains is the six tags in `providers.tf`:

```hcl
default_tags {
  tags = {
    Project     = var.project_name
    Environment = var.environment
    Owner       = var.owner
    ManagedBy   = "terraform"
    Purpose     = "aws-learning"
    CostCenter  = "personal-learning"
  }
}
```

If you read `aws-deployment-lab-runbook-terraform.md`, note its sample `providers.tf` and
`terraform.tfvars` snippets are **stale** — they still show `ExpiresOn`/`expires_on`, region
`ap-southeast-1`, and no `deploy_role_arn`. The runbook's prose is useful; trust the actual
`.tf` files over its code samples.

### 5. The deploy role is console-managed

`cloudtask-terraform-deploy` is created by hand in the AWS console and tracked by no Terraform
state. Its trust policy allows your IAM user; it holds AdministratorAccess.

**Why it can't be in Terraform:** a stack cannot create the role it needs in order to run.
Something has to exist before the first `apply`, and that something is best created once,
deliberately, by a human.

### 6. Account-specific values are gitignored

`terraform.tfvars` and `backend.hcl` both embed the AWS account ID, so both are gitignored
with committed `.example` twins. A fresh clone needs:

```bash
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
```

Forget this and `terraform plan` fails asking for `deploy_role_arn`, or `init` fails with no
bucket configured.

### 7. Secret values live in Terraform state

Terraform generates the RDS password and the JWT secret, and composes `DATABASE_URL`. All three
end up in the state file in plain text. `sensitive = true` hides values from terminal output
only — it does not encrypt state.

The mitigations are the bucket controls from `bootstrap/`: private, encrypted, versioned,
reachable only by the deploy role, never in git. Accepted for a lab; in production you would
generate secrets outside Terraform and have it reference them.

Details in [04](./04-state-and-backend.md#secrets-in-state).

### 8. `backend.hcl.example` is an addition to the spec

The spec's file tree for `environments/dev` doesn't list it. It exists because the partial
backend configuration needs a template. Harmless, and noted for completeness.

---

## Lab compromises

Not deviations from the spec — deliberate cost and convenience choices. Every one is the
"wrong" answer for production, and knowing which is which is most of the learning value here.

| Setting                                             | Where                          | Lab value | Production                           |
| --------------------------------------------------- | ------------------------------ | --------- | ------------------------------------ |
| `multi_az`                                          | `modules/rds`                  | `false`   | `true`                               |
| `backup_retention_period`                           | `modules/rds`                  | `1` day   | 7–35 days                            |
| `deletion_protection`                               | `modules/rds`                  | `false`   | `true`                               |
| `skip_final_snapshot`                               | `modules/rds`                  | `true`    | `false`                              |
| `apply_immediately`                                 | `modules/rds`, `modules/redis` | `true`    | `false` — use the maintenance window |
| `num_cache_clusters` / `automatic_failover_enabled` | `modules/redis`                | `1` / off | ≥ 2 with failover                    |
| `force_destroy`                                     | `modules/s3`, `bootstrap`      | `true`    | `false`                              |
| `force_delete`                                      | `modules/ecr`                  | `true`    | `false`                              |
| `recovery_window_in_days`                           | `modules/secrets`              | `0`       | 7–30                                 |
| NAT gateways                                        | `modules/networking`           | 1         | one per AZ, or VPC endpoints         |
| ALB listener                                        | `modules/alb`                  | HTTP :80  | HTTPS :443 with ACM + a :80 redirect |
| Redis AUTH token                                    | `modules/redis`                | none      | an auth token, or IAM auth           |
| `desired_count`                                     | all services                   | `0` → `1` | ≥ 2 per service, with autoscaling    |

The five destroy-related flags (`force_destroy`, `force_delete`, `skip_final_snapshot`,
`deletion_protection = false`, `recovery_window_in_days = 0`) all exist for the same reason:
so `scripts/aws-teardown.sh` completes in one pass without leaving paid-for orphans. They are
also exactly the settings that make accidental data loss trivially easy. Never copy this
combination into a real environment.

---

## Known rough edges

Two things in the current code that work but would be better written differently. Flagged for
awareness — no change is proposed here.

### Identifiers rebuilt as strings instead of piped from module outputs

```hcl
# environments/dev/main.tf:185
db_instance_identifier     = "${local.name_prefix}-postgres"
redis_replication_group_id = "${local.name_prefix}-redis"
```

The `monitoring` module needs the RDS instance identifier and the Redis replication group ID
for its alarm dimensions. Every other input to that module comes from a module output — these
two are reconstructed by repeating the naming pattern.

It is correct today because `modules/rds/main.tf:29` uses `"${var.name_prefix}-postgres"` and
`modules/redis/main.tf:12` uses `"${var.name_prefix}-redis"`. But nothing enforces that. If
someone renamed the RDS identifier inside the module, Terraform would still apply cleanly and
the alarm would silently point at a nonexistent dimension — sitting in `INSUFFICIENT_DATA`
forever, which is exactly the failure mode monitoring is supposed to catch.

Both modules already have output files, so the fix would be adding
`output "instance_identifier"` / `output "replication_group_id"` and referencing those.

### Redis port is hardcoded in an output

```hcl
# modules/redis/outputs.tf
output "port" {
  value = 6379
}
```

The value is right, but it's a constant where the resource attribute
(`aws_elasticache_replication_group.this.port`) was available. Compare with
`modules/rds/outputs.tf`, which reads real attributes throughout. Not a live bug — 6379 is the
only port ElastiCache Redis uses here — but it is the kind of duplication that goes stale
silently.

---

## Things that look broken but aren't

A short list, because each of these will make you double-check the code at least once.

**The `api-running-tasks` alarm is in ALARM right after `terraform apply`.** Correct. Services
are at `desired_count = 0`, ECS publishes no `RunningTaskCount` data point, and that alarm uses
`treat_missing_data = "breaching"` on purpose — see
[10](./10-monitoring.md#treat_missing_data-is-the-subtle-part). The first CI release resolves
it.

**The image tag says `bootstrap` and that image doesn't exist in ECR.** Correct, and nothing
ever pulls it: `desired_count = 0` means no task is ever launched from the initial revision.

**`terraform plan` shows no image change after a deploy.** Correct — `ignore_changes`.

**The SNS topic has no subscription.** Correct — email subscriptions need a human to click a
confirmation link, so Terraform would show permanent drift. Subscribe manually.

**The worker security group has no ingress rules at all.** Correct. Nothing ever connects to
the worker; it only makes outbound calls.

**The web service has no task role.** Correct. The web container makes no AWS API calls.

**`ecr:GetAuthorizationToken` and `ecs:RegisterTaskDefinition` are scoped to `"*"`.** Correct
and unavoidable — neither API supports resource-level permissions. Both are annotated in the
code so nobody mistakes it for carelessness.

**An empty `filter {}` in the S3 lifecycle rule.** Correct. A lifecycle rule must have a
filter; an empty one means "all objects".

**`private-data-rt` has no `route` blocks.** Correct, and the point. The implicit local route
still handles in-VPC traffic; there is simply no path to the internet.

---

## Where to look next

- [`DEVIATIONS.md`](../../../DEVIATIONS.md) — the authoritative deviation log, including the
  API and application-level entries not covered here
- [`aws-deployment-lab-runbook-terraform.md`](../../../aws-deployment-lab-runbook-terraform.md)
  — the 11 failure experiments (A–K). Each one deliberately breaks something and checks that
  the right alarm fires; running them is the fastest way to trust the monitoring
- [`application-spec.md`](../../../application-spec.md) — §12 network topology, §13 security
  groups, §14 resource inventory, §15 IAM, §19–20 Terraform layout and state

---

Back to the **[index](./README.md)**.
