# 02 — HCL primer

**What you'll learn:** the whole HashiCorp Configuration Language, using nothing but code
that already exists in this repository. Every snippet below is real — the file path is given
so you can open it side by side.

Read it once top to bottom, then use it as a lookup table.

---

## The shape of every HCL file

HCL has exactly one syntactic idea: **blocks containing arguments and nested blocks**.

```hcl
block_type "label_one" "label_two" {
  argument = value

  nested_block {
    argument = value
  }
}
```

- The number of labels depends on the block type: `resource` takes two, `variable` and
  `module` take one, `locals` and `terraform` take none.
- Arguments are `name = value`. **No commas** between them, and order does not matter.
- Comments are `#` (preferred in this repo) or `//`; `/* */` also works.

Files are just containers. Terraform concatenates every `.tf` file in a directory before
evaluating anything, so splitting `main.tf` / `variables.tf` / `outputs.tf` is purely a
human convention. This repo also has `versions.tf`, `providers.tf`, `backend.tf`, and
`iam.tf` in `environments/dev/` — all equally arbitrary, all equally valid.

## Values and types

```hcl
"cloudtask"                       # string
3000                              # number
true                              # bool
["10.20.0.0/24", "10.20.1.0/24"]  # list (tuple)
{ Name = "cloudtask-dev-vpc" }    # object / map
null                              # explicit "no value"
```

Strings can interpolate expressions with `${...}`:

```hcl
# modules/ecs-service/main.tf:10
qualified_name = "${var.name_prefix}-${var.service_name}"   # -> "cloudtask-dev-api"
```

If a string is _only_ an interpolation, drop the quotes and the `${}` — write `var.x`, not
`"${var.x}"`.

---

## `terraform` block — version pinning

```hcl
# environments/dev/versions.tf
terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

`required_version` guards the Terraform CLI itself. `~> 5.0` means "any 5.x, but not 6.0" —
allow patch and minor updates, block breaking major ones.

## `provider` block — configuring AWS

```hcl
# environments/dev/providers.tf
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

Two things worth understanding:

- **`assume_role`** — instead of using your IAM user's permissions directly, Terraform calls
  `sts:AssumeRole` on `cloudtask-terraform-deploy` and uses that role's temporary
  credentials for every AWS call. Your user only needs permission to assume the role. The
  role is created by hand in the console and is not managed by any stack (see
  [12 — Gotchas](./12-gotchas.md)).
- **`default_tags`** — every resource this provider creates gets these six tags
  automatically. You will not find `Project = ...` written on any individual resource in
  this repo; it comes from here. Resource-level `tags` blocks merge on top, which is why
  resources only ever set `Name`.

## `resource` block — a thing that exists in AWS

```hcl
# modules/rds/main.tf:28
resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class
  # ...
}
```

Three parts:

| Part          | Value in the example | Meaning                                                        |
| ------------- | -------------------- | -------------------------------------------------------------- |
| Block type    | `resource`           | Something Terraform creates and owns                           |
| Resource type | `aws_db_instance`    | Defined by the AWS provider; determines which API is called    |
| Local name    | `this`               | **Your** label. Referenced elsewhere as `aws_db_instance.this` |

The local name only has to be unique within its module. This repo uses `this` whenever a
module has exactly one of something (`aws_vpc.this`, `aws_lb.this`, `aws_ecs_cluster.this`)
and a descriptive name when there are several (`aws_security_group.api`, `.rds`, `.redis`).

**Attributes you set vs attributes you read.** You set `instance_class`. You read
`aws_db_instance.this.address` — a value AWS assigns and Terraform only knows after
creation. In a plan, unknown values show as `(known after apply)`.

## `variable` block — a module's input

```hcl
# modules/ecs-service/variables.tf
variable "container_port" {
  description = "Container port; null for services without one (worker)"
  type        = number
  default     = null
}

variable "environment_variables" {
  description = "Plain env vars for the container"
  type        = map(string)
  default     = {}
}

variable "subnet_ids" {
  description = "Private app subnets for tasks"
  type        = list(string)
}
```

- **With a `default`** → optional.
- **Without a `default`** → required; Terraform errors if the caller omits it. In
  `environments/dev/variables.tf`, `aws_account_id` is the only required variable.
- Types used in this repo: `string`, `number`, `bool`, `list(string)`, `map(string)`, and
  `set(string)` (in `modules/ecr/variables.tf`).

**`sensitive = true`** tells Terraform to print `(sensitive value)` instead of the value in
plan and apply output:

```hcl
# modules/secrets/variables.tf:31
variable "database_password" {
  description = "Master password"
  type        = string
  sensitive   = true
}
```

Important limitation: this only redacts terminal output. The real value **is** written to the
state file in plain text. That is a known, accepted trade-off here — see
[04 — State and backend](./04-state-and-backend.md#secrets-in-state).

Referenced as `var.<name>`.

## `output` block — a module's return value

```hcl
# modules/networking/outputs.tf
output "private_data_subnet_ids" {
  description = "Private data subnet ids (RDS, ElastiCache)"
  value       = aws_subnet.private_data[*].id
}
```

Outputs serve two purposes:

1. **Inside a module** — the only way a parent can read anything from it. Resources in a
   module are invisible from outside; only outputs cross the boundary.
2. **In the root stack** — printed after apply and readable with `terraform output -raw
<name>`. `environments/dev/outputs.tf` exists so you can grab the ALB DNS name and the CI
   role ARN for the `gh variable set` commands.

`sensitive = true` works on outputs too:

```hcl
# environments/dev/outputs.tf:28
output "rds_endpoint" {
  value     = module.rds.endpoint
  sensitive = true
}
```

## `locals` block — named intermediate values

```hcl
# environments/dev/main.tf:1
locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Namespace the worker's EMF metrics land in (metrics.service.ts).
  emf_namespace = "CloudTask/Dev"
}
```

A local is a variable you compute rather than receive. `local.name_prefix` evaluates to
`"cloudtask-dev"` and is then passed to every module, which is why every resource in the
account is named `cloudtask-dev-something`. Change `environment` to `staging` and the whole
stack renames itself.

Locals can call functions and read other locals:

```hcl
# modules/networking/main.tf:9
locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  public_cidrs       = ["10.20.0.0/24", "10.20.1.0/24"]
  private_app_cidrs  = ["10.20.10.0/24", "10.20.11.0/24"]
  private_data_cidrs = ["10.20.20.0/24", "10.20.21.0/24"]
}
```

Referenced as `local.<name>`. Note the singular `local.`, even though the block is `locals`.

## `data` block — read something without owning it

A `data` source **queries** AWS instead of creating anything. Terraform will never modify or
delete it.

```hcl
# modules/networking/main.tf:5 — "which AZs does this region have?"
data "aws_availability_zones" "available" {
  state = "available"
}

# modules/s3/main.tf:4 — "what account am I in?"
data "aws_caller_identity" "current" {}
```

Used in `modules/s3/main.tf` to make the bucket name globally unique:

```hcl
bucket = "${var.name_prefix}-exports-${data.aws_caller_identity.current.account_id}"
```

Referenced as `data.<type>.<name>.<attribute>`.

`data "aws_iam_policy_document"` is a special case: it queries nothing, it just builds JSON.
It exists so you can write IAM policies as HCL blocks instead of embedded JSON strings, with
type checking and interpolation:

```hcl
# environments/dev/iam.tf:7
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}
```

You then hand `.json` to whatever needs a policy:

```hcl
resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name_prefix}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}
```

## `module` block — calling a module

```hcl
# environments/dev/main.tf:15
module "security" {
  source = "../../modules/security"

  name_prefix    = local.name_prefix
  vpc_id         = module.networking.vpc_id
  container_port = var.container_port
}
```

`source` is the only special argument; everything else must match a `variable` declared in
that module. `module.networking.vpc_id` reads the `vpc_id` **output** of the `networking`
module.

That single line is also how Terraform learns the ordering: because `security` reads an
output of `networking`, Terraform knows the VPC must exist before the security groups. You
never write ordering explicitly — it is inferred from references. This is called the
**dependency graph**, and it is the single most important idea in Terraform.

Calling one module several times just means several `module` blocks with different labels —
`api_service`, `worker_service`, and `web_service` all point at `../../modules/ecs-service`.

---

## Repetition: `count` and `for_each`

### `count` — make N copies

```hcl
# modules/networking/main.tf:31
resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${var.name_prefix}-public-${substr(local.azs[count.index], -1, 1)}" }
}
```

`count = 2` creates two subnets. Inside the block, `count.index` is `0` then `1`, used to
pick the matching CIDR and AZ from the lists. The resources are addressed as
`aws_subnet.public[0]` and `aws_subnet.public[1]`.

### `count` as an on/off switch

The idiom `count = <condition> ? 1 : 0` makes a resource conditional:

```hcl
# modules/networking/main.tf:62
resource "aws_eip" "nat" {
  count = var.enable_nat_gateway ? 1 : 0

  domain = "vpc"
  # ...
}

resource "aws_nat_gateway" "this" {
  count = var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  # ...
}
```

With `enable_nat_gateway = false`, both resources simply don't exist. Note that everything
using them must then index `[0]` — and must itself be count-gated, or Terraform errors on
an empty list. That is why `aws_route.private_app_nat` is gated too:

```hcl
# modules/networking/main.tf:107
resource "aws_route" "private_app_nat" {
  count = var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.private_app.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}
```

### `for_each` — make one copy per named key

```hcl
# modules/ecr/main.tf:4
resource "aws_ecr_repository" "this" {
  for_each = var.repository_names   # set(string) = ["api", "worker", "web"]

  name                 = "${var.name_prefix}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}
```

This creates three repositories, addressed by **name** rather than number:
`aws_ecr_repository.this["api"]`, `["worker"]`, `["web"]`.

**Why prefer `for_each` over `count` here?** With `count`, the identity of each resource is
its position in a list. Remove `"worker"` from the middle of the list and `web` shifts from
index 2 to index 1 — Terraform sees that as "destroy and recreate the ECR repository". With
`for_each`, `["web"]` stays `["web"]` no matter what else changes. Use `count` for "N
identical things", `for_each` for "one per named item".

Inside the block you get:

- `each.key` — the key (for a set, the value itself)
- `each.value` — the value

You can also `for_each` over another resource's instances:

```hcl
# modules/ecr/main.tf:18
resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name
  # ...
}
```

Here `each.value` is a whole ECR repository object, so `each.value.name` is that
repository's name. One lifecycle policy per repository, automatically.

---

## Expressions

### Conditional (ternary)

`condition ? value_if_true : value_if_false`

```hcl
# modules/ecs-service/main.tf:38
portMappings = var.container_port == null ? [] : [
  {
    containerPort = var.container_port
    protocol      = "tcp"
  }
]

# modules/ecs-service/main.tf:96
health_check_grace_period_seconds = var.target_group_arn == null ? null : 60

# modules/networking/outputs.tf:28
value = var.enable_nat_gateway ? aws_nat_gateway.this[0].id : null
```

This is how one `ecs-service` module serves both the api (has a port, has a load balancer)
and the worker (has neither).

### `for` expressions — transform a collection

Two forms. **List output** uses `[...]`:

```hcl
# modules/ecs-service/main.tf:45
environment = [
  for k, v in var.environment_variables : { name = k, value = v }
]
```

Read it as: "for each key `k` and value `v` in the map, produce `{ name = k, value = v }`".
This converts an HCL map into the array-of-objects shape the ECS API demands:

```hcl
# what you write in environments/dev/main.tf
environment_variables = {
  NODE_ENV = "production"
  PORT     = "3000"
}
```

```json
// what ECS receives
[
  { "name": "NODE_ENV", "value": "production" },
  { "name": "PORT", "value": "3000" }
]
```

**Map output** uses `{...}` with `=>`:

```hcl
# modules/ecr/outputs.tf:1
output "repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}
```

That turns the three ECR repository objects into
`{ api = "...", worker = "...", web = "..." }`, which the environment then indexes by name:

```hcl
# environments/dev/main.tf:93
image = "${module.ecr.repository_urls["api"]}:${var.api_image_tag}"
```

### Splat `[*]` — pluck one attribute from every instance

```hcl
# modules/networking/outputs.tf:11
value = aws_subnet.public[*].id
```

Shorthand for `[for s in aws_subnet.public : s.id]`. Turns two subnet objects into a list of
two subnet IDs. Only works with `count`, not `for_each`.

---

## `dynamic` blocks — conditional nested blocks

Ternaries work for _arguments_. But what if a whole nested **block** should sometimes not
exist? `count` can't help: it applies to the whole resource.

```hcl
# modules/ecs-service/main.tf:86
dynamic "load_balancer" {
  for_each = var.target_group_arn == null ? [] : [var.target_group_arn]

  content {
    target_group_arn = load_balancer.value
    container_name   = var.service_name
    container_port   = var.container_port
  }
}
```

Read it as: "generate one `load_balancer { ... }` block for each element of this list". The
list is empty when `target_group_arn` is null, so **zero** blocks are generated; otherwise
one. Inside `content`, `load_balancer.value` is the current element.

This is exactly what lets the worker share the `ecs-service` module: the worker has no port
and no target group, so it gets no `load_balancer` block at all.

## `lifecycle` — override Terraform's default behaviour

```hcl
# modules/ecs-service/main.tf:98
# CI (release.yml) registers new task-definition revisions on every deploy
# and scales services up on first deploy; Terraform must never revert either.
lifecycle {
  ignore_changes = [task_definition, desired_count]
}
```

Normally Terraform reverts drift. Here that would be actively harmful: GitHub Actions
deploys new images by registering a new task-definition revision and setting
`desired_count = 1`. Without `ignore_changes`, the next `terraform apply` would roll the
service back to the bootstrap placeholder image and scale it to zero.

`ignore_changes` says: _"after creation, stop caring about these attributes."_ Somebody else
owns them now. This one block is the reason the whole `desired_count = 0` /
`image_tag = "bootstrap"` scheme works.

## `depends_on` — the escape hatch for ordering

You almost never need this, because references create dependencies automatically. You need
it when a dependency is real but invisible to Terraform:

```hcl
# modules/networking/main.tf:62
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? 1 : 0
  domain = "vpc"

  tags = { Name = "${var.name_prefix}-nat-eip" }

  depends_on = [aws_internet_gateway.this]
}
```

Nothing in the EIP block mentions the internet gateway, but AWS requires the IGW to be
attached before a VPC-domain EIP can be allocated. `depends_on` states that by hand.

**Rule of thumb:** if you find yourself writing `depends_on`, check first whether you could
reference the other resource's attribute instead. That is always better, because it survives
refactoring.

---

## Functions

Terraform ships built-in functions (there is no way to define your own). The ones used here:

| Function     | Where                           | What it does                                                             |
| ------------ | ------------------------------- | ------------------------------------------------------------------------ |
| `jsonencode` | many                            | HCL value → JSON string                                                  |
| `slice`      | `modules/networking/main.tf:10` | `slice(names, 0, 2)` — first two AZ names                                |
| `substr`     | `modules/networking/main.tf:39` | `substr(az, -1, 1)` — last character of `ap-south-1a` → `a`, for the tag |
| `tostring`   | `environments/dev/main.tf:105`  | number → string, because container env vars must be strings              |
| `values`     | `environments/dev/iam.tf:39`    | map → list of its values, e.g. the three ECR ARNs                        |
| `urlencode`  | `modules/secrets/main.tf:22`    | escapes the DB password so it is safe inside a connection URL            |

`jsonencode` deserves special attention, because four resources in this repo need JSON that
AWS defines, not Terraform:

```hcl
# modules/sqs/main.tf:12
redrive_policy = jsonencode({
  deadLetterTargetArn = aws_sqs_queue.dlq.arn
  maxReceiveCount     = var.max_receive_count
})
```

You write an HCL object; `jsonencode` renders it as the JSON string AWS wants. The benefit
over writing a raw JSON string: you can interpolate references, and a typo in the HCL is
caught at plan time. The same trick builds ECS `container_definitions`, the ECR lifecycle
policy, the Secrets Manager `secret_string`, and the 9-widget CloudWatch dashboard.

---

## How to read any reference

Every dotted path in HCL follows one of these shapes:

| Reference                                     | Reads                                                           |
| --------------------------------------------- | --------------------------------------------------------------- |
| `var.container_port`                          | An input variable of the current module                         |
| `local.name_prefix`                           | A local value in the current module                             |
| `aws_vpc.this.id`                             | An attribute of a resource in the current module                |
| `aws_subnet.public[0].id`                     | ...of the first instance of a `count`-ed resource               |
| `aws_ecr_repository.this["api"]`              | ...of a named instance of a `for_each`-ed resource              |
| `data.aws_caller_identity.current.account_id` | An attribute of a data source                                   |
| `module.networking.vpc_id`                    | An **output** of a called module (never its internal resources) |
| `each.key` / `each.value`                     | Current key/value inside a `for_each` block                     |
| `count.index`                                 | Current index inside a `count` block                            |
| `load_balancer.value`                         | Current element inside a `dynamic "load_balancer"` block        |

Two rules that trip up beginners:

- **You cannot reach inside a module.** `module.networking.aws_vpc.this.id` is invalid.
  Anything the parent needs must be declared as an `output`.
- **Resource names are not AWS names.** `aws_db_instance.this` is a Terraform label;
  `cloudtask-dev-postgres` is the AWS identifier, set by the `identifier` argument.

---

## What this repo does _not_ use

So you don't wonder where they are:

- **`validation {}`** blocks on variables — only one, on `aws_account_id` (12 digits) in
  `environments/dev` and `bootstrap`. Every other invalid input fails at the AWS API instead.
- **`moved`, `import`, `check`** blocks — none.
- **Workspaces** — one directory per environment is used instead.
- **Provider aliases** — a single region, a single `aws` provider.
- **Remote/registry modules** — every module is a local relative path.

---

Next: **[03 — Architecture overview](./03-architecture-overview.md)** — what all this HCL
actually builds.
