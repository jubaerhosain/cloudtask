# 03 — Architecture overview

**What you'll learn:** what the stack actually looks like once applied, in six diagrams —
runtime components, network topology, security groups, the module graph, the
Terraform-vs-CI ownership split, and one end-to-end request flow.

---

## 1. Runtime architecture

Three containers, four backing services, one load balancer.

```mermaid
flowchart TB
  user["Browser"]

  subgraph aws["AWS account, region ap-south-1"]
    subgraph public["Public subnets"]
      alb["Application Load Balancer<br/>HTTP :80"]
      nat["NAT gateway"]
    end

    subgraph app["Private app subnets — ECS Fargate"]
      web["web task<br/>Next.js :3000"]
      api["api task<br/>NestJS :3000"]
      worker["worker task<br/>no port"]
    end

    subgraph data["Private data subnets"]
      pg[("RDS Postgres 16<br/>db.t4g.micro")]
      redis[("ElastiCache Redis 7.1<br/>cache.t4g.micro, TLS")]
    end

    subgraph regional["Regional AWS services"]
      sqs["SQS exports queue<br/>+ DLQ"]
      s3["S3 exports bucket<br/>private"]
      sm["Secrets Manager<br/>cloudtask/dev/application"]
      ecr["ECR<br/>3 repositories"]
      cw["CloudWatch<br/>logs, metrics, alarms"]
    end
  end

  user -->|"HTTP"| alb
  alb -->|"default rule"| web
  alb -->|"/api/*, /health, /ready, /docs*"| api

  api --> pg
  api --> redis
  api -->|"SendMessage"| sqs
  sqs -->|"ReceiveMessage, long poll 20s"| worker
  worker --> pg
  worker -->|"PutObject"| s3
  api -.->|"presigned GET, 300s"| s3

  web -.->|"via NAT"| nat
  api -.-> nat
  worker -.-> nat
  nat -.-> sm
  nat -.-> ecr
  nat -.-> cw
```

**Why each box exists** — traced to the application code that requires it:

| Component         | Required by                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ALB               | Only public entry point. Routes by path because api and web are separate services on the same hostname.                              |
| web task          | `apps/web` — Next.js standalone server                                                                                               |
| api task          | `apps/api` — NestJS HTTP API, prefix `api/v1`, plus `/health`, `/ready`, `/docs`                                                     |
| worker task       | `apps/worker` — a NestJS **standalone context**, no HTTP server, so it needs no port and no load balancer                            |
| RDS Postgres      | `DATABASE_URL`; TypeORM entities + 4 migrations in `apps/api/src/database/migrations/`                                               |
| ElastiCache Redis | api only: 60s project-summary cache and the Lua rate limiter (`apps/api/src/ratelimit/redis-rate-limiter.ts`)                        |
| SQS + DLQ         | api enqueues export jobs, worker consumes them; poison messages land in the DLQ after 3 failed receives                              |
| S3                | worker writes `exports/{userId}/{exportId}.csv`; api hands out presigned download URLs                                               |
| Secrets Manager   | the only two values marked secret: `DATABASE_URL`, `JWT_SECRET`                                                                      |
| ECR               | `.github/workflows/release.yml` pushes Git-SHA-tagged images here; ECS pulls from here                                               |
| CloudWatch        | container stdout goes here via the `awslogs` driver; the worker's EMF metrics ride the same stream                                   |
| NAT gateway       | tasks are in private subnets with no public IP, but still need outbound HTTPS to reach ECR, Secrets Manager, SQS, S3, and CloudWatch |

Note the dotted **presigned URL** arrow: the browser downloads the CSV directly from S3
using a URL the api signs. That is why the bucket can stay completely private — see
[08](./08-module-data-layer.md#s3--the-exports-bucket).

## 2. Network topology

Two availability zones, six subnets, three route tables. Built by
[`modules/networking`](../modules/networking/main.tf).

```mermaid
flowchart TB
  igw["Internet gateway"]

  subgraph vpc["VPC 10.20.0.0/16 — DNS support + hostnames enabled"]
    direction TB

    subgraph azA["Availability zone A"]
      pubA["public-a<br/>10.20.0.0/24<br/>map_public_ip: true"]
      appA["private-app-a<br/>10.20.10.0/24"]
      dataA["private-data-a<br/>10.20.20.0/24"]
    end

    subgraph azB["Availability zone B"]
      pubB["public-b<br/>10.20.1.0/24<br/>map_public_ip: true"]
      appB["private-app-b<br/>10.20.11.0/24"]
      dataB["private-data-b<br/>10.20.21.0/24"]
    end

    natgw["NAT gateway<br/>+ Elastic IP<br/>lives in public-a only"]
  end

  igw <--> pubA
  igw <--> pubB
  pubA --- natgw
  natgw -->|"0.0.0.0/0"| igw
  appA -->|"0.0.0.0/0"| natgw
  appB -->|"0.0.0.0/0"| natgw
```

The three route tables, and the one that matters most:

| Route table       | Attached to        | Default route `0.0.0.0/0`          |
| ----------------- | ------------------ | ---------------------------------- |
| `public-rt`       | public-a, public-b | → internet gateway                 |
| `private-app-rt`  | private-app-a, -b  | → NAT gateway                      |
| `private-data-rt` | private-data-a, -b | **none — no default route at all** |

That empty route table is a deliberate security control, not an oversight:

```hcl
# modules/networking/main.tf:122
# No default route: private-data subnets are reachable only from inside the VPC.
resource "aws_route_table" "private_data" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-private-data-rt" }
}
```

The database and cache have no path to the internet in either direction. Even if their
security groups were misconfigured, there is no route for traffic to take.

Three things to notice:

- **The NAT gateway is single, in AZ A.** Production would use one per AZ so an AZ failure
  can't cut off the other AZ's outbound traffic. One is cheaper, and this is a lab.
- **Tasks get `assign_public_ip = false`** (`modules/ecs-service/main.tf:83`) and sit in the
  private-app subnets. NAT is the only way out, which is why `enable_nat_gateway = true` is
  required in `terraform.tfvars` — with it off, tasks cannot even pull their own image.
- **AZs are discovered, not hardcoded** — `slice(data.aws_availability_zones.available.names, 0, 2)`
  takes whichever first two AZs the region offers.

## 3. Security groups

Six groups, 14 rules. Built by [`modules/security`](../modules/security/main.tf). Arrows
point in the direction traffic flows.

```mermaid
flowchart LR
  net["Internet<br/>0.0.0.0/0"]

  sgAlb["sg: alb"]
  sgWeb["sg: web"]
  sgApi["sg: api"]
  sgWorker["sg: worker"]
  sgRds["sg: rds"]
  sgRedis["sg: redis"]
  awsapi["AWS APIs via NAT<br/>0.0.0.0/0 :443"]

  net -->|":80"| sgAlb
  sgAlb -->|":3000"| sgWeb
  sgAlb -->|":3000"| sgApi
  sgApi -->|":5432"| sgRds
  sgWorker -->|":5432"| sgRds
  sgApi -->|":6379"| sgRedis
  sgWeb -->|":443"| awsapi
  sgApi -->|":443"| awsapi
  sgWorker -->|":443"| awsapi
```

Three design decisions worth understanding:

**1. Rules reference security groups, not IP ranges.** `sg: rds` allows port 5432 from
`sg: api` — not from `10.20.10.0/24`. Any task launched into the api security group is
allowed automatically, wherever its IP lands; nothing else is, even in the same subnet.

```hcl
# modules/security/main.tf:162
resource "aws_vpc_security_group_ingress_rule" "rds_from_api" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from api"
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
```

**2. Rules are separate resources, not inline blocks.** The module declares six bare
`aws_security_group` resources with no rules, then 14 separate rule resources. From the
file header:

```hcl
# modules/security/main.tf:1
# Security groups per spec §13. All service-to-service rules reference SGs,
# never CIDRs. Rules live in separate resources so the ALB↔api/web and
# api/worker↔rds/redis reference cycles don't trip Terraform's graph.
```

If the rules were inline, `sg: alb` would reference `sg: api` (egress) while `sg: api`
referenced `sg: alb` (ingress) — a cycle, and Terraform refuses to build a graph with
cycles. Splitting the rules out breaks it: the two groups are created first, then the rules
that connect them.

**3. Redis has no password.** The security group _is_ the authentication:

```hcl
# modules/redis/main.tf:1
# ... No AUTH token — the app has no auth config; access
# control is SG-only (api SG ingress).
```

Also note the worker has **no ingress rules at all**. Nothing ever connects _to_ it; it only
makes outbound calls. And the web task has no database or Redis egress — it only needs
outbound HTTPS to pull its image and ship logs.

## 4. Module dependency graph

15 `module` blocks in [`environments/dev/main.tf`](../environments/dev/main.tf), plus the
IAM roles in `iam.tf`. Arrows mean "reads an output of", which is exactly what determines
apply order.

```mermaid
flowchart TD
  networking["networking"]
  security["security"]
  alb["alb"]
  ecr["ecr"]
  cluster["ecs_cluster"]
  rds["rds"]
  redis["redis"]
  sqs["sqs"]
  s3["s3"]
  secrets["secrets"]
  iam["iam.tf<br/>3 roles, not a module"]
  apisvc["api_service"]
  workersvc["worker_service"]
  websvc["web_service"]
  monitoring["monitoring"]
  oidc["github_oidc"]

  networking --> security
  networking --> alb
  networking --> rds
  networking --> redis
  security --> alb
  security --> rds
  security --> redis
  rds --> secrets

  ecr --> iam
  s3 --> iam
  sqs --> iam

  cluster --> apisvc
  cluster --> workersvc
  cluster --> websvc
  ecr --> apisvc
  ecr --> workersvc
  ecr --> websvc
  secrets --> apisvc
  secrets --> workersvc
  redis --> apisvc
  sqs --> apisvc
  sqs --> workersvc
  s3 --> apisvc
  s3 --> workersvc
  alb --> apisvc
  alb --> websvc
  iam --> apisvc
  iam --> workersvc
  iam --> websvc

  apisvc --> monitoring
  workersvc --> monitoring
  websvc --> monitoring
  cluster --> monitoring
  alb --> monitoring
  sqs --> monitoring

  apisvc --> oidc
  workersvc --> oidc
  websvc --> oidc
  ecr --> oidc
  cluster --> oidc
  iam --> oidc
```

Reading it:

- **`networking` is the root.** Nothing can be created before the VPC.
- **`ecr`, `ecs_cluster`, `sqs`, `s3` have no dependencies** — Terraform creates them in
  parallel with the VPC.
- **The three `*_service` modules are the convergence point.** They need the cluster, an
  image URL, subnets, a security group, IAM roles, secrets, and (for api and web) a target
  group. They are the slowest part of an apply.
- **There is a circular-looking relationship between `iam.tf` and the services** which
  Terraform resolves cleanly: `iam.tf` reads the services' **log group ARNs**, while the
  services read the **role ARNs**. Different attributes, so no cycle.
- **`monitoring` and `github_oidc` are leaves** — nothing depends on them.

## 5. Who owns what: Terraform vs CI

This is the single most confusing thing about this stack until you see it laid out.

```mermaid
flowchart TB
  subgraph tf["terraform apply — run from your laptop"]
    direction TB
    tf1["VPC, subnets, routes, NAT"]
    tf2["Security groups"]
    tf3["ALB, target groups, listener rules"]
    tf4["ECR repositories"]
    tf5["ECS cluster"]
    tf6["ECS services + FIRST task definition<br/>image tag = 'bootstrap', desired_count = 0"]
    tf7["RDS, Redis, SQS, S3, Secrets"]
    tf8["IAM roles, OIDC provider, CI role"]
    tf9["CloudWatch log groups, alarms, dashboard"]
  end

  subgraph ci["release.yml — runs in GitHub Actions"]
    direction TB
    ci1["Build + push images<br/>tag = git SHA"]
    ci2["Register NEW task-definition revisions"]
    ci3["Run migrations as a one-shot ECS task"]
    ci4["update-service --desired-count 1"]
    ci5["Wait for stability, verify no rollback"]
    ci6["Smoke test /health, /ready, /"]
  end

  tf --> ci
  ci -.->|"drift Terraform must IGNORE"| tf6
```

Terraform creates each ECS service once, with a placeholder image and zero tasks. CI then
takes over the two attributes that change on every deploy:

```hcl
# modules/ecs-service/main.tf:98
# CI (release.yml) registers new task-definition revisions on every deploy
# and scales services up on first deploy; Terraform must never revert either.
lifecycle {
  ignore_changes = [task_definition, desired_count]
}
```

Without that block, every `terraform apply` after the first deploy would revert your
production services to the placeholder image and scale them to zero.

**Why `desired_count = 0` at bootstrap?** Because the `bootstrap` image tag doesn't exist in
ECR yet. A service with `desired_count = 1` would immediately try to pull a nonexistent
image, fail, retry, and never stabilise. At zero, nothing is pulled and `terraform apply`
completes cleanly. From `environments/dev/terraform.tfvars`:

```hcl
# Leave at "bootstrap": services start at desired_count = 0, so the placeholder
# image is never pulled. CI registers real git-SHA revisions and scales up on
# the first release run.
```

The two sides agree on a **naming contract**, asserted in the header of `release.yml` and
honoured by the Terraform modules:

| Thing            | Name                                  | Set in                           |
| ---------------- | ------------------------------------- | -------------------------------- |
| Cluster          | `cloudtask-dev`                       | `modules/ecs-cluster/main.tf`    |
| Service / family | `cloudtask-dev-{api,worker,web}`      | `modules/ecs-service/main.tf:10` |
| Container name   | `api` \| `worker` \| `web`            | `modules/ecs-service/main.tf:34` |
| ECR repository   | `cloudtask-dev-{api,worker,web}`      | `modules/ecr/main.tf:7`          |
| Log group        | `/ecs/cloudtask-dev-{api,worker,web}` | `modules/ecs-service/main.tf:14` |

Rename any of those in Terraform and the release workflow breaks.

## 6. One request end to end: the CSV export

This flow touches almost every component, which makes it the best single example.

```mermaid
sequenceDiagram
  participant B as Browser
  participant L as ALB
  participant A as api task
  participant R as Redis
  participant Q as SQS
  participant W as worker task
  participant D as RDS
  participant S as S3

  B->>L: POST /api/v1/projects/:id/exports
  L->>A: forward (path rule /api/*)
  A->>R: rate-limit check (Lua fixed window)
  A->>D: INSERT exports row (status pending)
  A->>Q: SendMessage {exportId, userId, projectId}
  A-->>B: 202 Accepted {exportId}

  Q->>W: ReceiveMessage (long poll, 20s)
  W->>D: SELECT tasks for project
  W->>S: PutObject exports/{userId}/{exportId}.csv
  W->>D: UPDATE exports SET status = completed
  W->>Q: DeleteMessage
  Note over W: EMF metrics printed to stdout<br/>→ CloudWatch Logs → CloudTask/Dev namespace

  B->>L: GET /api/v1/exports/:id
  L->>A: forward
  A->>D: SELECT export
  A->>S: presign GetObject (300s)
  A-->>B: {status: completed, downloadUrl}
  B->>S: GET presigned URL (direct, bypasses ALB)
```

Two details in that diagram explain infrastructure choices elsewhere:

- **`DeleteMessage` comes last.** If the worker crashes mid-job the message is never
  deleted, SQS redelivers it after the visibility timeout, and after 3 failed receives it
  moves to the DLQ — which the `exports-dlq-messages` alarm watches. The S3 key is
  deterministic (`exports/{userId}/{exportId}.csv`) so a retry overwrites rather than
  duplicating.
- **The browser fetches from S3 directly.** No traffic through the ALB, no public bucket.

---

Next: **[04 — State and backend](./04-state-and-backend.md)** — where Terraform keeps its
records.
