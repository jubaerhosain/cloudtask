# 05 — The dev environment, file by file

**What you'll learn:** every file in `environments/dev/`, in the order it makes sense to read
them, with the HCL explained as it appears.

This is the only directory you ever run `terraform` in day to day. Terraform concatenates
all `.tf` files here before evaluating anything, so the split below is a human convention —
but a useful one.

```text
environments/dev/
├── versions.tf         which Terraform and providers   (18 lines)
├── providers.tf        how to talk to AWS              (19)
├── backend.tf          where state lives               (12)
├── backend.hcl         gitignored account-specific bits (12)
├── variables.tf        the 15 knobs                    (100)
├── terraform.tfvars    gitignored: this account's values (28)
├── main.tf             15 module calls                 (214)
├── iam.tf              3 IAM roles                     (153)
└── outputs.tf          16 values to read after apply   (75)
```

---

## `versions.tf` — pinning

```hcl
terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
    tls    = { source = "hashicorp/tls", version = "~> 4.0" }
  }
}
```

Three providers, each pulling its weight:

- **`aws`** — everything.
- **`random`** — `random_password` twice: the RDS master password
  (`modules/rds/main.tf:4`) and the JWT secret (`modules/secrets/main.tf:5`).
- **`tls`** — exactly once: `data "tls_certificate" "github"` in `modules/github-oidc`, to
  read GitHub's OIDC certificate thumbprint at apply time rather than hardcoding a
  fingerprint that rotates.

`required_version = ">= 1.11.0"` is not arbitrary — `use_lockfile` in the S3 backend needs
Terraform 1.10 or newer.

## `providers.tf` — how Terraform authenticates and tags

```hcl
locals {
  deploy_role_arn = "arn:aws:iam::${var.aws_account_id}:role/${var.project_name}-terraform-deploy"
}

provider "aws" {
  region = var.aws_region

  assume_role {
    role_arn     = local.deploy_role_arn
    session_name = "terraform"
  }

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
}
```

The ARN is **composed in a local** rather than passed in whole, so the AWS account ID is the
single account-specific value in the stack. That keeps it confined to the gitignored
`account.auto.tfvars` and lets `terraform.tfvars` be committed.

**`assume_role`.** Your IAM user's credentials are used only to call `sts:AssumeRole` on
`cloudtask-terraform-deploy`; every subsequent AWS call uses that role's temporary
credentials. The benefit: your day-to-day user needs almost no permissions, and the role's
CloudTrail entries clearly identify Terraform activity.

That role is **created by hand in the console and is not managed by any Terraform stack** —
a deliberate choice recorded in `DEVIATIONS.md`, since a stack cannot create the role it
needs in order to run.

**`default_tags`.** Every resource created through this provider gets all six tags without
mentioning them. This is why individual resources in the modules only ever set `Name`:

```hcl
# modules/networking/main.tf:22
tags = { Name = "${var.name_prefix}-vpc" }
```

The resulting VPC carries `Name`, `Project`, `Environment`, `Owner`, `ManagedBy`, `Purpose`,
and `CostCenter`. Handy for filtering the bill by `CostCenter = personal-learning`.

## `backend.tf` — state location

Covered fully in [04 — State and backend](./04-state-and-backend.md). Short version: the
`bucket` is deliberately omitted and supplied at init time from the gitignored `backend.hcl`,
because the bucket name embeds the AWS account ID.

## `variables.tf` — the knobs

15 variables. Only one is required (no `default`): **`aws_account_id`**.

| Variable                  | Type   | Default                  | What it controls                                          |
| ------------------------- | ------ | ------------------------ | --------------------------------------------------------- |
| `aws_region`              | string | `ap-south-1`             | Region for everything                                     |
| `project_name`            | string | `cloudtask`              | First half of `name_prefix`                               |
| `environment`             | string | `dev`                    | Second half of `name_prefix`                              |
| `owner`                   | string | `jubaer`                 | The `Owner` tag                                           |
| `aws_account_id`          | string | **required**             | Account to deploy into; builds the role the provider assumes |
| `enable_nat_gateway`      | bool   | `true`                   | Whether tasks can reach the internet at all               |
| `github_repository`       | string | `jubaerhosain/cloudtask` | Which repo may assume the CI role                         |
| `create_oidc_provider`    | bool   | `true`                   | Create the GitHub OIDC provider, or reuse an existing one |
| `api_image_tag`           | string | `bootstrap`              | Image tag for the first task definition only              |
| `worker_image_tag`        | string | `bootstrap`              | ditto                                                     |
| `web_image_tag`           | string | `bootstrap`              | ditto                                                     |
| `database_instance_class` | string | `db.t4g.micro`           | RDS size                                                  |
| `redis_node_type`         | string | `cache.t4g.micro`        | ElastiCache size                                          |
| `desired_count`           | number | `0`                      | Initial task count per service                            |
| `container_port`          | number | `3000`                   | Port api and web listen on                                |
| `log_level`               | string | `info`                   | `LOG_LEVEL` env var for api and worker                    |

Two clusters of variables carry comments worth reading in full, because they encode the
CI hand-off:

```hcl
# Image tags are only used for the FIRST task-definition revision. CI registers
# new revisions with real git-SHA tags on every deploy, and the ECS services
# ignore task_definition drift, so these stay at "bootstrap" forever.

# Services are created at 0 so nothing pulls the placeholder images; the CI
# deploy job scales to 1 on the first release run (and ECS services ignore
# desired_count drift afterwards).
```

The only `validation {}` block is on `aws_account_id` (12 digits), which fails fast on a
typo that would otherwise surface as an opaque `AssumeRole` denial. An invalid
`database_instance_class` is caught by the AWS API during apply, not by Terraform during
plan.

## `terraform.tfvars` — this environment's values

**Committed.** It holds no account-specific values, so it is versioned like any other
config. Terraform loads any file named exactly `terraform.tfvars` automatically — no flag
needed.

```hcl
aws_region   = "ap-south-1"
project_name = "cloudtask"
environment  = "dev"
owner        = "jubaer"

# Required for tasks to reach ECR/Secrets Manager/SQS/S3 from private subnets.
enable_nat_gateway = true

# Set false if the AWS account already has a GitHub OIDC provider.
create_oidc_provider = true

api_image_tag    = "bootstrap"
worker_image_tag = "bootstrap"
web_image_tag    = "bootstrap"
desired_count    = 0

database_instance_class = "db.t4g.micro"
redis_node_type         = "cache.t4g.micro"
```

## `account.auto.tfvars` — the one gitignored value

Gitignored (`*.auto.tfvars`); copied from `account.auto.tfvars.example`. Terraform
auto-loads every `*.auto.tfvars` file, so this needs no `-var-file` flag either.

```hcl
aws_account_id = "<account-id>"
```

That is the whole file. `providers.tf` turns it into
`arn:aws:iam::<account-id>:role/cloudtask-terraform-deploy`. The same account ID has to be
repeated by hand in `backend.hcl`, because a `backend` block cannot reference variables or
locals — see [04](./04-state-and-backend.md).

`create_oidc_provider` deserves a note: an AWS account can only have **one** OIDC provider
per URL. If you already federate another repo with GitHub Actions in this account, set this
to `false` and the module will reference the existing provider by constructed ARN instead of
trying to create a duplicate.

---

## `main.tf` — the 15 module calls

### The prefix that names everything

```hcl
locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Namespace the worker's EMF metrics land in (metrics.service.ts).
  emf_namespace = "CloudTask/Dev"
}
```

`local.name_prefix` is `"cloudtask-dev"`, and it is passed to every single module. That's why
every resource in the account is `cloudtask-dev-*` and you can find the whole stack with one
console filter.

### Layer 1 — foundation

```hcl
module "networking" {
  source = "../../modules/networking"

  name_prefix        = local.name_prefix
  enable_nat_gateway = var.enable_nat_gateway
}

module "security" {
  source = "../../modules/security"

  name_prefix    = local.name_prefix
  vpc_id         = module.networking.vpc_id
  container_port = var.container_port
}
```

`module.networking.vpc_id` is the first inter-module reference you meet, and it is also how
Terraform learns the order: security groups need a VPC, so networking is applied first.
Nothing states that explicitly.

### Layer 2 — independent services

`ecr` and `ecs_cluster` take only `name_prefix`, so they depend on nothing and are created in
parallel with the VPC:

```hcl
module "ecr" {
  source = "../../modules/ecr"

  name_prefix = local.name_prefix
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"

  name_prefix = local.name_prefix
}
```

Same for `sqs` and `s3` further down the file.

### Layer 3 — load balancer and data stores

```hcl
module "alb" {
  source = "../../modules/alb"

  name_prefix       = local.name_prefix
  vpc_id            = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
  security_group_id = module.security.alb_security_group_id
  container_port    = var.container_port
}

module "rds" {
  source = "../../modules/rds"

  name_prefix             = local.name_prefix
  private_data_subnet_ids = module.networking.private_data_subnet_ids
  security_group_id       = module.security.rds_security_group_id
  instance_class          = var.database_instance_class
}

module "redis" {
  source = "../../modules/redis"

  name_prefix             = local.name_prefix
  private_data_subnet_ids = module.networking.private_data_subnet_ids
  security_group_id       = module.security.redis_security_group_id
  node_type               = var.redis_node_type
}
```

Notice the subnet choice encodes the security tiers from
[03 §2](./03-architecture-overview.md#2-network-topology): the ALB gets **public** subnets,
RDS and Redis get **private-data** subnets, and (below) the ECS tasks get **private-app**.

### Layer 4 — the secret, assembled from RDS outputs

```hcl
module "secrets" {
  source = "../../modules/secrets"

  project_name      = var.project_name
  environment       = var.environment
  database_host     = module.rds.address
  database_port     = module.rds.port
  database_name     = module.rds.database_name
  database_username = module.rds.master_username
  database_password = module.rds.master_password
}
```

The secrets module can't run until RDS exists, because the connection string needs the real
endpoint hostname that AWS assigns. That's a genuine ordering constraint, expressed purely
through references.

### Layer 5 — the three services

This is the payoff of the module split: one module, three instances, each configured
differently.

```hcl
module "api_service" {
  source = "../../modules/ecs-service"

  name_prefix        = local.name_prefix
  service_name       = "api"
  cluster_arn        = module.ecs_cluster.cluster_arn
  image              = "${module.ecr.repository_urls["api"]}:${var.api_image_tag}"
  desired_count      = var.desired_count
  container_port     = var.container_port
  subnet_ids         = module.networking.private_app_subnet_ids
  security_group_id  = module.security.api_security_group_id
  execution_role_arn = aws_iam_role.ecs_execution.arn
  task_role_arn      = aws_iam_role.api_task.arn
  target_group_arn   = module.alb.api_target_group_arn
  aws_region         = var.aws_region

  environment_variables = {
    NODE_ENV                 = "production"
    PORT                     = tostring(var.container_port)
    REDIS_HOST               = module.redis.primary_endpoint_address
    REDIS_PORT               = tostring(module.redis.port)
    REDIS_TLS_ENABLED        = "true"
    AWS_REGION               = var.aws_region
    EXPORT_QUEUE_URL         = module.sqs.queue_url
    EXPORT_BUCKET_NAME       = module.s3.bucket_name
    LOG_LEVEL                = var.log_level
    ENABLE_FAILURE_ENDPOINTS = "false"
  }

  secrets = {
    DATABASE_URL = "${module.secrets.secret_arn}:DATABASE_URL::"
    JWT_SECRET   = "${module.secrets.secret_arn}:JWT_SECRET::"
  }
}
```

Points to absorb:

- **`image`** is built by string interpolation from the ECR module's map output and the image
  tag variable: `.../cloudtask-dev-api:bootstrap`.
- **`tostring(var.container_port)`** — `container_port` is a `number`, but container
  environment variables must be strings, and `environment_variables` is typed `map(string)`.
  Omit `tostring` and you get a type error at plan time.
- **`environment_variables` vs `secrets`** — the split matches
  `packages/contracts/src/config/api-config.schema.ts`. Anything not sensitive is a plain env
  var visible in the task definition; only `DATABASE_URL` and `JWT_SECRET` are injected from
  Secrets Manager.
- **The `valueFrom` syntax.** `"${module.secrets.secret_arn}:DATABASE_URL::"` is the ECS
  format for "read one JSON key out of this secret". The shape is
  `<secret-arn>:<json-key>:<version-stage>:<version-id>` — the last two are left empty, so
  ECS uses the current version. Without the key suffix ECS would inject the whole JSON blob
  as the value.

The worker instance differs in exactly the ways you'd expect:

```hcl
module "worker_service" {
  # ... no container_port, no target_group_arn
  security_group_id  = module.security.worker_security_group_id
  task_role_arn      = aws_iam_role.worker_task.arn

  environment_variables = {
    NODE_ENV                       = "production"
    AWS_REGION                     = var.aws_region
    EXPORT_QUEUE_URL               = module.sqs.queue_url
    EXPORT_BUCKET_NAME             = module.s3.bucket_name
    SQS_WAIT_TIME_SECONDS          = "20"
    SQS_VISIBILITY_TIMEOUT_SECONDS = "60"
    LOG_LEVEL                      = var.log_level
  }

  secrets = {
    DATABASE_URL = "${module.secrets.secret_arn}:DATABASE_URL::"
  }
}
```

No `container_port` and no `target_group_arn` — both default to `null` in the module, which
is what makes the `dynamic "load_balancer"` block generate nothing and `portMappings` come
out as `[]`. No Redis variables either: the worker never touches Redis. And no `JWT_SECRET`:
it never validates a token.

And the web instance is the thinnest of the three:

```hcl
module "web_service" {
  # ...
  # NEXT_PUBLIC_API_BASE_URL is baked into the image at build time.
  environment_variables = {
    NODE_ENV = "production"
    PORT     = tostring(var.container_port)
  }
}
```

No `task_role_arn` at all — the web container makes no AWS API calls, so it gets no task
role. And that comment matters operationally: `NEXT_PUBLIC_*` variables are inlined by
Next.js at build time, so the API URL is a Docker **build arg**, not a runtime env var. That
is why `release.yml` passes `NEXT_PUBLIC_API_BASE_URL` to `docker build`, and why changing
the ALB URL requires rebuilding the web image rather than just restarting it.

### Layer 6 — monitoring and CI federation

```hcl
module "monitoring" {
  source = "../../modules/monitoring"

  name_prefix                = local.name_prefix
  aws_region                 = var.aws_region
  cluster_name               = module.ecs_cluster.cluster_name
  api_service_name           = module.api_service.service_name
  worker_service_name        = module.worker_service.service_name
  web_service_name           = module.web_service.service_name
  alb_arn_suffix             = module.alb.alb_arn_suffix
  queue_name                 = module.sqs.queue_name
  dlq_name                   = module.sqs.dlq_name
  db_instance_identifier     = "${local.name_prefix}-postgres"
  redis_replication_group_id = "${local.name_prefix}-redis"
  emf_namespace              = local.emf_namespace
}
```

Most inputs come from module outputs, but the last two rebuild the RDS and Redis identifiers
as strings. That works today because the modules use the same pattern — but it is a
maintenance hazard, since renaming inside `modules/rds` would silently break the alarm's
dimension. Flagged in [12 — Gotchas](./12-gotchas.md#known-rough-edges).

```hcl
module "github_oidc" {
  source = "../../modules/github-oidc"

  name_prefix          = local.name_prefix
  github_repository    = var.github_repository
  create_oidc_provider = var.create_oidc_provider
  ecr_repository_arns  = values(module.ecr.repository_arns)
  cluster_arn          = module.ecs_cluster.cluster_arn

  service_arns = [
    module.api_service.service_arn,
    module.worker_service.service_arn,
    module.web_service.service_arn,
  ]

  api_task_definition_family = module.api_service.task_definition_family

  passable_role_arns = [
    aws_iam_role.ecs_execution.arn,
    aws_iam_role.api_task.arn,
    aws_iam_role.worker_task.arn,
  ]

  log_group_prefix_arn = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}*"
}
```

`values(module.ecr.repository_arns)` converts the map `{api = "arn:...", worker = "...", web
= "..."}` into a plain list, because the module's policy just needs "these three ARNs" and
doesn't care which is which. Everything else is the raw material for a tightly scoped CI
policy — detailed in [09](./09-iam-and-github-oidc.md).

---

## `iam.tf` — why IAM lives here, not in a module

```hcl
# ECS execution role + per-service task roles (spec §15, least privilege).
# Lives at the environment level because the policies reference ARNs from
# several modules.
```

A module can only see what it is given. These policies need the ECR ARNs, the S3 bucket ARN,
the SQS queue ARN, the secret ARN, and the three log group ARNs — five different modules. You
could pass all of that into an `iam` module, but the variable list would be longer than the
resources. Keeping it at the environment level is the simpler call.

Contents, covered in detail in [09](./09-iam-and-github-oidc.md):

- one shared trust policy (`data.aws_iam_policy_document.ecs_tasks_assume`), reused by all
  three roles
- `aws_iam_role.ecs_execution` + its policy — pull images, write logs, read the secret
- `aws_iam_role.api_task` + its policy — `sqs:SendMessage`, `s3:GetObject`, metrics
- `aws_iam_role.worker_task` + its policy — SQS consume, `s3:PutObject`, metrics

## `outputs.tf` — what to read after apply

16 outputs. Their real purpose is to feed the manual steps that follow an apply:

| Output                                                         | Used for                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `application_url`, `alb_dns_name`                              | Open the app; build `NEXT_PUBLIC_API_BASE_URL`                 |
| `github_ci_role_arn`                                           | `gh variable set AWS_ROLE_ARN` — un-gates the release workflow |
| `sns_topic_arn`                                                | Subscribe your email to alarms (Terraform does not do this)    |
| `private_app_subnet_ids`, `api_security_group_id`              | Network config for the CI migration `run-task`                 |
| `dashboard_name`                                               | Find the CloudWatch dashboard                                  |
| `export_queue_url`, `export_dlq_url`, `export_bucket_name`     | Poking at the export pipeline by hand                          |
| `nat_gateway_id`                                               | Failure experiments and teardown verification                  |
| `rds_endpoint` (sensitive), `redis_endpoint`                   | Debugging                                                      |
| `ecr_repository_urls`, `ecs_cluster_name`, `ecs_service_names` | Manual `aws ecs` / `docker push` commands                      |

Two HCL details on display here:

```hcl
output "application_url" {
  description = "The app entry point"
  value       = "http://${module.alb.alb_dns_name}"
}

output "ecs_service_names" {
  value = {
    api    = module.api_service.service_name
    worker = module.worker_service.service_name
    web    = module.web_service.service_name
  }
}
```

An output value can be any expression — a built string, or an object literal assembled from
several modules. And `rds_endpoint` is marked `sensitive = true`, so it prints as
`(sensitive value)` unless you ask for it explicitly with
`terraform output -raw rds_endpoint`.

---

Next: **[06 — Network edge modules](./06-module-network-edge.md)**.
