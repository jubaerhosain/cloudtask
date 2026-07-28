# CloudTask Amazon ECS Express Mode Deployment, Failure-Testing, Troubleshooting, and Cleanup Runbook

## 1. Purpose

This runbook deploys the CloudTask application from `application-spec.md` using **Amazon ECS Express Mode**, driven entirely from the AWS CLI.

Express Mode is a managed shape for containerized web services. A single `create-express-gateway-service` call provisions a Fargate service, an internet-facing Application Load Balancer with SSL/TLS, target groups, security groups, auto scaling policies, CloudWatch logging, rollback alarms, and a public HTTPS URL. You do not create or name any of those resources yourself.

The objective is to understand **what a managed compute abstraction hides**, by deploying the same three services this project deploys by hand in `aws-deployment-lab-runbook-manual.md` and by Terraform in `aws-deployment-lab-runbook-terraform.md`.

The lab sequence is:

1. Prepare and test the application locally.
2. Create the data and messaging layer (PostgreSQL, Redis, SQS, S3, Secrets Manager).
3. Create ECR repositories, IAM roles, log groups, and the ECS cluster.
4. Initialize the database schema with a one-off task.
5. Deploy the API and web services as Express Mode services.
6. Deploy the worker as a plain Fargate service.
7. Validate the application end to end.
8. Introduce controlled failures.
9. Troubleshoot and restore the system.
10. Delete every costly resource.

---

## 2. Which runbook to use

CloudTask has four deployment runbooks. They build the **same application** on deliberately different foundations.

| Runbook | Provisioning method | What it teaches | What it hides |
|---|---|---|---|
| `aws-deployment-lab-runbook-manual.md` | AWS Console, by hand | Every wire: subnets, route tables, SGs, target groups, listener rules | Nothing |
| `aws-deployment-lab-runbook-terraform.md` | Terraform modules | Declarative infrastructure, state, drift, plan/apply discipline | Nothing, but expresses it as code |
| **this runbook** | AWS CLI + ECS Express Mode | Managed compute: what you still own vs. what AWS assumes | ALB, target groups, listener rules, TLS, auto scaling, canary deployments |
| `aws-deployment-lab-runbook-beanstalk.md` | EB CLI + Docker Compose | Platform-as-a-service: instance-hosted containers, enhanced health | ALB, Auto Scaling group, instance provisioning, reverse proxy |

Run the manual runbook **first** if you have not already. This runbook is far shorter, and the reason it is shorter is the entire lesson. You cannot see what Express Mode removed unless you have built it yourself once.

---

## 3. Proposed AWS architecture

```mermaid
flowchart TB
    User[Browser or API client]
    subgraph Managed["Managed by Express Mode"]
        ALB[Application Load Balancer\nHTTPS, auto-provisioned, shared]
        WebSvc[Express service: web\nFargate, autoscaled]
        ApiSvc[Express service: api\nFargate, autoscaled]
    end
    subgraph Owned["Created and owned by you"]
        Worker[ECS Fargate worker service\nNo load balancer]
        Migrate[One-off migration task]
        RDS[(RDS PostgreSQL\nDefault VPC, not public)]
        Redis[(ElastiCache Redis\nDefault VPC, TLS)]
        SQS[SQS export queue + DLQ]
        S3[S3 export bucket]
        ECR[ECR repositories]
        SM[Secrets Manager]
        CW[CloudWatch Logs]
    end

    User -->|HTTPS| ALB
    ALB --> WebSvc
    ALB --> ApiSvc
    WebSvc -->|browser calls the api URL directly| ApiSvc
    ApiSvc --> RDS
    ApiSvc --> Redis
    ApiSvc --> SQS
    ApiSvc --> SM
    Worker --> RDS
    Worker --> SQS
    Worker --> S3
    Worker --> SM
    Migrate --> RDS
    ApiSvc --> CW
    WebSvc --> CW
    Worker --> CW
    ECR --> WebSvc
    ECR --> ApiSvc
    ECR --> Worker
```

### How services connect

- RDS: database DNS endpoint and port 5432, via `DATABASE_URL` from Secrets Manager
- ElastiCache: Redis primary endpoint and port 6379, **API only** — the worker does not use Redis
- S3: bucket name through the AWS SDK, written by the **worker**, presigned by the **API**
- SQS: queue URL through the AWS SDK, sent by the API and received by the worker
- api and web: reached through the URL Express Mode assigns each service
- ECR: image repository URI, pulled by the task execution role
- Secrets Manager: secret ARN, resolved by the task execution role before the container starts

### How this differs from the specification architecture

Three deliberate deviations from `application-spec.md` §11–§15. Each is a consequence of using Express Mode, not an oversight.

**1. Default VPC, no NAT Gateway.** The specification builds a `10.20.0.0/16` VPC with six subnets across three tiers and one NAT Gateway. This runbook uses the account's **default VPC and its public subnets**, with tasks assigned public IPs for outbound access to ECR, SQS, S3, and Secrets Manager.

Express Mode expects a default VPC with public subnets, or subnets you nominate. Building the specification's three-tier VPC and then handing Express Mode two subnets from it would work, but it would reintroduce the NAT Gateway — the single largest fixed cost in this lab — for no learning gain the manual runbook has not already delivered.

RDS and ElastiCache still have `publicly-accessible` disabled and are reachable only from the task security group. **This is not the production topology.** Production application tiers belong in private subnets behind NAT or VPC endpoints. The manual and Terraform runbooks build that; this one deliberately does not.

**2. Two public URLs instead of one ALB with path rules.** The specification routes `/api/*`, `/health`, `/ready`, and `/docs*` to the API target group and everything else to the web target group, behind one ALB. Express Mode assigns each service its **own** URL and does not expose listener-rule configuration. So `api` and `web` get separate hostnames and the browser calls the API hostname cross-origin. This is why `CORS_ORIGINS` carries real weight in this runbook and almost none in the others.

**3. `ManagedBy=ecs-express`.** The specification's tagging contract uses `ManagedBy=terraform`. Resources created here are tagged `ManagedBy=ecs-express` because they are created by CLI calls against the Express Mode API. Every other tag value matches the specification exactly. Resources that Express Mode creates on your behalf carry whatever tags you passed to `create-express-gateway-service`; §39 verifies that rather than assuming it.

---

## 4. Cost warning

This lab creates billable resources. In rough order of cost, delete these first:

- Application Load Balancer — created and shared by Express Mode, and **deleted only when the last Express service using it is deleted**
- RDS database instance, plus any retained automated backups and snapshots
- ElastiCache Redis replication group
- ECS Fargate tasks (api, web, worker) — billed per task per second, so an autoscaled service at `maxTaskCount=4` can cost four times your estimate
- Public IPv4 addresses attached to tasks, billed hourly per address
- CloudWatch log storage
- ECR image storage
- S3 objects and versions

Usually free as standalone objects, although traffic or related resources may cost money:

- Default VPC, subnets, route tables, Internet Gateway
- Security groups
- IAM roles and policies
- SQS queues at lab volume
- An ECS cluster with no running tasks

**Critical cost reminder:** Express Mode's scaling ceiling defaults high. This runbook pins `maxTaskCount` low on purpose. Do not raise it without deciding you accept the bill.

Keep the environment for one lab session only unless you intentionally accept ongoing charges.

---

## 5. Mandatory tags

Add these tags to every taggable resource you create:

```text
Project=cloudtask
Environment=dev
Owner=jubaer
ManagedBy=ecs-express
Purpose=aws-learning
CostCenter=personal-learning
ExpiresOn=<YYYY-MM-DD>
```

`ManagedBy=ecs-express` is the one intentional difference from the specification's tagging contract, as explained in §3. Every other tag value matches the specification exactly.

### Tagging rule

Export the tag set once, in two shapes, because AWS CLI tag syntax differs between services:

```bash
export EXPIRES_ON=$(date -u -d '+2 days' +%F)   # macOS: date -u -v+2d +%F

# ECS and ELB style: key=,value=
export TAGS_ECS="key=Project,value=cloudtask key=Environment,value=dev \
key=Owner,value=jubaer key=ManagedBy,value=ecs-express \
key=Purpose,value=aws-learning key=CostCenter,value=personal-learning \
key=ExpiresOn,value=$EXPIRES_ON"

# EC2, RDS, IAM and Secrets Manager style: Key=,Value=
export TAGS_EC2="Key=Project,Value=cloudtask Key=Environment,Value=dev \
Key=Owner,Value=jubaer Key=ManagedBy,Value=ecs-express \
Key=Purpose,Value=aws-learning Key=CostCenter,Value=personal-learning \
Key=ExpiresOn,Value=$EXPIRES_ON"

# SQS, S3 and CloudWatch Logs style: comma-separated k=v
export TAGS_KV="Project=cloudtask,Environment=dev,Owner=jubaer,ManagedBy=ecs-express,Purpose=aws-learning,CostCenter=personal-learning,ExpiresOn=$EXPIRES_ON"
```

Use names beginning with `cloudtask-dev-` so resources are easy to find. Resources specific to this deployment path use a `cloudtask-dev-express-` prefix so they cannot be confused with leftovers from the manual or Terraform runbooks.

---

# Part A — Before calling AWS

## 6. Account and region preparation

### Step 6.1 — choose one region

Select one AWS Region and use it for the whole lab. This runbook uses:

```text
ap-south-1
```

Express Mode is available in every Region where ECS and Fargate are supported. Pick the Region closest to you, or match the Region your other CloudTask labs used so the costs are comparable.

**Note:** creating resources in the wrong Region is the most common mistake in this lab. Every command below reads `$AWS_REGION`, so set it once and never type a Region literal again.

### Step 6.2 — account safety

1. Enable MFA for the root account.
2. Do not use the root account for the lab.
3. Use an IAM Identity Center user or a dedicated IAM user/role.
4. Do not put long-lived AWS access keys in source code.
5. Do not commit `.env` files.

### Step 6.3 — create a budget

Open **Billing and Cost Management → Budgets**.

1. Choose **Create budget**.
2. Select a cost budget.
3. Enter a small monthly budget appropriate for your account.
4. Add email alerts at useful thresholds.
5. Save the budget.

A budget alerts you; it does not automatically delete or stop resources.

### Step 6.4 — set the shell variables this runbook uses

Every subsequent command depends on these. Set them in one shell and stay in it. If you open a new terminal, re-run this step and §8 before continuing.

```bash
export AWS_REGION=ap-south-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export GIT_SHA=$(git rev-parse --short HEAD)
export CLUSTER=cloudtask-dev
export SECRET_NAME=cloudtask/dev/application
```

### Verify

```bash
aws sts get-caller-identity --output table
echo "region=$AWS_REGION account=$AWS_ACCOUNT_ID sha=$GIT_SHA"
```

Expected: the identity is your lab user or role, **not** the root account, and no value is empty.

### Step 6.5 — confirm the CLI is new enough

Express Mode commands were added to the AWS CLI in late 2025. An older CLI fails with `Invalid choice: 'create-express-gateway-service'`.

```bash
aws --version
aws ecs create-express-gateway-service help >/dev/null 2>&1 \
  && echo "express mode available" \
  || echo "UPGRADE THE AWS CLI"
```

Expected: `express mode available`. If not, upgrade to the latest AWS CLI v2 and re-run.

### Step 6.6 — settle the CPU and memory units before you deploy

**Read this step; do not skip it.** AWS documentation is inconsistent about the units of `--cpu` and `--memory` on `create-express-gateway-service`. The Express Mode tutorial shows `--cpu 2 --memory 4` alongside prose describing "2 vCPU and 4 GB memory", implying **vCPU and GB**. The AWS CLI command reference documents defaults of `256` and `512`, implying **CPU units and MiB**, matching classic ECS task definitions.

This runbook uses the vCPU/GB form. Confirm which your CLI version expects before running anything in Part D:

```bash
aws ecs create-express-gateway-service --generate-cli-skeleton \
  | python3 -m json.tool
```

Look at the `cpu` and `memory` fields and their types. If the skeleton or `aws ecs create-express-gateway-service help` indicates CPU units and MiB, substitute `--cpu 512 --memory 1024` wherever this runbook writes `--cpu 0.5 --memory 1`, and scale the other values the same way.

Getting this wrong in the safe direction (asking for more than you meant) inflates your bill. Getting it wrong in the other direction produces tasks that are killed for exceeding memory, which surfaces as an unexplained health-check failure.

---

## 7. Local verification before deploying

Deploying an application you have not run locally turns one unknown into three. Confirm the stack is healthy first.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then bring up the full local stack and exercise it:

```bash
docker compose up --build -d
docker compose ps
```

Expected: `postgres`, `redis`, and `localstack` are healthy; `migrate` has exited `0`; `api`, `worker`, and `web` are running.

```bash
curl -fsS http://localhost:3001/health && echo
curl -fsS http://localhost:3001/ready  && echo
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3000/
```

Expected: `/health` returns `{"status":"ok"}`, `/ready` reports `ok`, and the web root returns `200`.

Run the API end-to-end suite:

```bash
pnpm --filter @cloudtask/api test:e2e
```

**Note:** the package name is `@cloudtask/api`, not `api`. An unscoped `--filter api` matches no package in this workspace and silently runs nothing. There is also no root `test:integration` or root `test:e2e` script — the command above is the real one.

Tear the local stack down before moving to AWS, so you never confuse local behavior with deployed behavior:

```bash
docker compose down -v
```

---

## 8. Confirm the default VPC and choose subnets

Express Mode places its load balancer in public subnets. Without a default VPC, `create-express-gateway-service` fails unless you nominate subnets. This runbook nominates them explicitly either way, so the deployment is reproducible and so you can authorize database access from a security group you control.

### Step 8.1 — find the default VPC

```bash
export VPC_ID=$(aws ec2 describe-vpcs \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text --region "$AWS_REGION")
export VPC_CIDR=$(aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query 'Vpcs[0].CidrBlock' --output text --region "$AWS_REGION")
echo "vpc=$VPC_ID cidr=$VPC_CIDR"
```

Expected: a real VPC ID and CIDR. If `VPC_ID` is `None`, the account has no default VPC in this Region — create one with `aws ec2 create-default-vpc --region "$AWS_REGION"`, or nominate two public subnets from an existing VPC and set `VPC_ID`, `SUBNET_A`, and `SUBNET_B` by hand.

### Step 8.2 — pick two subnets in different Availability Zones

```bash
aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC_ID" \
  --query 'sort_by(Subnets,&AvailabilityZone)[].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]' \
  --output table --region "$AWS_REGION"
```

Choose two rows in **different** Availability Zones with `MapPublicIpOnLaunch` set to `True`, then:

```bash
export SUBNET_A=subnet-xxxxxxxxxxxxxxxxx
export SUBNET_B=subnet-yyyyyyyyyyyyyyyyy
export SUBNETS="${SUBNET_A},${SUBNET_B}"
```

### Verify

```bash
aws ec2 describe-subnets --subnet-ids "$SUBNET_A" "$SUBNET_B" \
  --query 'Subnets[].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]' \
  --output table --region "$AWS_REGION"
```

Expected: two subnets, two distinct Availability Zones, both `True`. An ALB requires at least two Availability Zones; a same-AZ pair fails at service creation.

---

# Part B — Data and messaging services

Express Mode manages compute and traffic. It does not manage state. Everything in this Part you create and own, exactly as in the manual runbook — the commands are CLI rather than console clicks.

## 9. Security groups

Three security groups. Referencing security groups by ID rather than by CIDR is the specification's §12 rule and it still applies here.

### Step 9.1 — create the groups

```bash
export TASK_SG=$(aws ec2 create-security-group \
  --group-name cloudtask-dev-express-tasks-sg \
  --description "CloudTask Express Mode and worker tasks" \
  --vpc-id "$VPC_ID" --region "$AWS_REGION" \
  --query GroupId --output text)

export RDS_SG=$(aws ec2 create-security-group \
  --group-name cloudtask-dev-express-rds-sg \
  --description "CloudTask RDS PostgreSQL" \
  --vpc-id "$VPC_ID" --region "$AWS_REGION" \
  --query GroupId --output text)

export REDIS_SG=$(aws ec2 create-security-group \
  --group-name cloudtask-dev-express-redis-sg \
  --description "CloudTask ElastiCache Redis" \
  --vpc-id "$VPC_ID" --region "$AWS_REGION" \
  --query GroupId --output text)

aws ec2 create-tags --resources "$TASK_SG" "$RDS_SG" "$REDIS_SG" \
  --tags $TAGS_EC2 --region "$AWS_REGION"

echo "task=$TASK_SG rds=$RDS_SG redis=$REDIS_SG"
```

### Step 9.2 — authorize only what is needed

```bash
# PostgreSQL: from the task security group only.
aws ec2 authorize-security-group-ingress \
  --group-id "$RDS_SG" --protocol tcp --port 5432 \
  --source-group "$TASK_SG" --region "$AWS_REGION"

# Redis: from the task security group only.
aws ec2 authorize-security-group-ingress \
  --group-id "$REDIS_SG" --protocol tcp --port 6379 \
  --source-group "$TASK_SG" --region "$AWS_REGION"

# Application traffic on 3000, from inside the VPC.
aws ec2 authorize-security-group-ingress \
  --group-id "$TASK_SG" --protocol tcp --port 3000 \
  --cidr "$VPC_CIDR" --region "$AWS_REGION"
```

Two honest compromises here, both narrower than they look but wider than the specification:

- The specification gives api and worker separate security groups, so that Redis accepts connections from the api group only. This runbook shares one task group between api, web, and worker, so the Redis rule is wider than the specification's. Splitting them is a worthwhile exercise once the deployment works.
- Port 3000 is opened to the VPC CIDR rather than to the Express Mode load balancer's security group, because AWS creates that group and its ID does not exist until the first service does. §23 tightens this to the real group ID once it is discoverable.

### Verify

```bash
aws ec2 describe-security-groups --group-ids "$RDS_SG" "$REDIS_SG" "$TASK_SG" \
  --query 'SecurityGroups[].{Name:GroupName,Ingress:IpPermissions[].{Port:FromPort,FromSG:UserIdGroupPairs[].GroupId,Cidr:IpRanges[].CidrIp}}' \
  --output json --region "$AWS_REGION"
```

Expected: the RDS group allows 5432 from `$TASK_SG` only, the Redis group allows 6379 from `$TASK_SG` only, and the task group allows 3000 from the VPC CIDR. **No group allows anything from `0.0.0.0/0`.**

---

## 10. RDS PostgreSQL

### Step 10.1 — create a DB subnet group

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name cloudtask-dev-express-db-subnets \
  --db-subnet-group-description "CloudTask dev DB subnets" \
  --subnet-ids "$SUBNET_A" "$SUBNET_B" \
  --tags $TAGS_EC2 --region "$AWS_REGION"
```

### Step 10.2 — create the instance

The master password is managed by AWS in its own secret, so no database password is ever typed into a shell, a file, or your shell history.

```bash
aws rds create-db-instance \
  --db-instance-identifier cloudtask-dev-postgres \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --allocated-storage 20 \
  --storage-type gp3 \
  --db-name cloudtask \
  --master-username cloudtask_admin \
  --manage-master-user-password \
  --db-subnet-group-name cloudtask-dev-express-db-subnets \
  --vpc-security-group-ids "$RDS_SG" \
  --no-publicly-accessible \
  --backup-retention-period 1 \
  --no-multi-az \
  --no-deletion-protection \
  --no-auto-minor-version-upgrade \
  --tags $TAGS_EC2 \
  --region "$AWS_REGION"
```

**Cost reminder:** `db.t4g.micro` with 20 GB gp3 and 1-day backups is the cheapest shape that still behaves like real RDS. Single-AZ and disabled deletion protection are acceptable **only** because this is a disposable lab.

Creation takes several minutes:

```bash
aws rds wait db-instance-available \
  --db-instance-identifier cloudtask-dev-postgres --region "$AWS_REGION"
```

### Step 10.3 — record the endpoint and compose `DATABASE_URL`

```bash
export DB_HOST=$(aws rds describe-db-instances \
  --db-instance-identifier cloudtask-dev-postgres \
  --query 'DBInstances[0].Endpoint.Address' --output text --region "$AWS_REGION")

export RDS_SECRET_ARN=$(aws rds describe-db-instances \
  --db-instance-identifier cloudtask-dev-postgres \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text --region "$AWS_REGION")

# The generated password can contain characters that are not URL-safe, so
# percent-encode it before embedding it in a connection string.
export DB_PASSWORD_ENC=$(aws secretsmanager get-secret-value \
  --secret-id "$RDS_SECRET_ARN" --query SecretString --output text --region "$AWS_REGION" \
  | python3 -c 'import json,sys,urllib.parse; print(urllib.parse.quote(json.load(sys.stdin)["password"], safe=""))')

export DATABASE_URL="postgres://cloudtask_admin:${DB_PASSWORD_ENC}@${DB_HOST}:5432/cloudtask"
```

### Verify

```bash
aws rds describe-db-instances --db-instance-identifier cloudtask-dev-postgres \
  --query 'DBInstances[0].[DBInstanceStatus,PubliclyAccessible,Engine,DBName]' \
  --output table --region "$AWS_REGION"
echo "host=$DB_HOST url_length=${#DATABASE_URL}"
```

Expected: status `available`, `PubliclyAccessible` is `False`, `DBName` is `cloudtask`, and `url_length` is comfortably over 60. **Do not echo `$DATABASE_URL`** — it contains the password.

**Note:** `application-spec.md` §17 makes `DATABASE_URL` the single canonical database setting. Discrete `DB_HOST`/`DB_PORT`/`DB_USER` variables are not part of the configuration contract and the application ignores them. `DB_HOST` above is a shell convenience only.

---

## 11. ElastiCache Redis

Redis serves the **API only** — the project summary cache and rate limiting. The worker never connects to it. The API degrades gracefully when Redis is unreachable, which §31 exercises deliberately.

### Step 11.1 — create a cache subnet group

```bash
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name cloudtask-dev-express-redis-subnets \
  --cache-subnet-group-description "CloudTask dev Redis subnets" \
  --subnet-ids "$SUBNET_A" "$SUBNET_B" \
  --region "$AWS_REGION"
```

### Step 11.2 — create the replication group

In-transit encryption on Redis requires a **replication group**, not a bare cache cluster. That is why this is `create-replication-group` with zero replicas rather than `create-cache-cluster`.

```bash
aws elasticache create-replication-group \
  --replication-group-id cloudtask-dev-redis \
  --replication-group-description "CloudTask dev Redis" \
  --engine redis \
  --cache-node-type cache.t4g.micro \
  --num-node-groups 1 \
  --replicas-per-node-group 0 \
  --transit-encryption-enabled \
  --cache-subnet-group-name cloudtask-dev-express-redis-subnets \
  --security-group-ids "$REDIS_SG" \
  --tags $TAGS_EC2 \
  --region "$AWS_REGION"

aws elasticache wait replication-group-available \
  --replication-group-id cloudtask-dev-redis --region "$AWS_REGION"
```

### Step 11.3 — record the primary endpoint

```bash
export REDIS_HOST=$(aws elasticache describe-replication-groups \
  --replication-group-id cloudtask-dev-redis \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
  --output text --region "$AWS_REGION")
echo "redis=$REDIS_HOST"
```

### Verify

```bash
aws elasticache describe-replication-groups --replication-group-id cloudtask-dev-redis \
  --query 'ReplicationGroups[0].[Status,TransitEncryptionEnabled,CacheNodeType]' \
  --output table --region "$AWS_REGION"
```

Expected: status `available`, `TransitEncryptionEnabled` is `True`, node type `cache.t4g.micro`.

**Note:** because in-transit encryption is on, the API **must** set `REDIS_TLS_ENABLED=true`. With that flag unset the client opens a plaintext connection, the server closes it, `/ready` reports `degraded`, and every cache read silently misses while the API otherwise appears healthy. This is the most common misconfiguration in this lab.

---

## 12. SQS export queue and dead-letter queue

Create the DLQ first, because the main queue's redrive policy references its ARN.

```bash
export DLQ_URL=$(aws sqs create-queue \
  --queue-name cloudtask-dev-export-dlq \
  --attributes '{"SqsManagedSseEnabled":"true","MessageRetentionPeriod":"1209600"}' \
  --region "$AWS_REGION" --query QueueUrl --output text)

export DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' \
  --output text --region "$AWS_REGION")

export EXPORT_QUEUE_URL=$(aws sqs create-queue \
  --queue-name cloudtask-dev-export-queue \
  --attributes "$(python3 - <<'PY'
import json, os
print(json.dumps({
    "SqsManagedSseEnabled": "true",
    "ReceiveMessageWaitTimeSeconds": "20",
    "VisibilityTimeout": "60",
    "RedrivePolicy": json.dumps({
        "deadLetterTargetArn": os.environ["DLQ_ARN"],
        "maxReceiveCount": "3",
    }),
}))
PY
)" \
  --region "$AWS_REGION" --query QueueUrl --output text)

export QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url "$EXPORT_QUEUE_URL" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' \
  --output text --region "$AWS_REGION")

aws sqs tag-queue --queue-url "$EXPORT_QUEUE_URL" --tags "$TAGS_KV" --region "$AWS_REGION"
aws sqs tag-queue --queue-url "$DLQ_URL"          --tags "$TAGS_KV" --region "$AWS_REGION"
```

The nested JSON in a redrive policy is a string inside a string. Building it with `python3` avoids the backslash-escaping mistakes that make this the most frequently mistyped command in the whole runbook.

### Verify

```bash
aws sqs get-queue-attributes --queue-url "$EXPORT_QUEUE_URL" \
  --attribute-names RedrivePolicy ReceiveMessageWaitTimeSeconds VisibilityTimeout \
  --output json --region "$AWS_REGION"
```

Expected: the redrive policy names the DLQ ARN with `maxReceiveCount` 3, long polling is 20 seconds, and the visibility timeout is 60 seconds.

**Note:** the worker's `SQS_VISIBILITY_TIMEOUT_SECONDS` defaults to 60 and should not exceed the queue's own visibility timeout, or a slow export can be redelivered while it is still being processed. The worker is idempotent — a conditional `UPDATE ... WHERE status <> 'completed'` claim plus a deterministic S3 key at `exports/{userId}/{exportId}.csv` — so redelivery is safe, but it wastes work.

---

## 13. S3 export bucket

Bucket names are globally unique, so include the account ID and Region.

```bash
export EXPORT_BUCKET_NAME="cloudtask-dev-exports-${AWS_ACCOUNT_ID}-${AWS_REGION}"

aws s3api create-bucket \
  --bucket "$EXPORT_BUCKET_NAME" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
```

**Note:** in `us-east-1` only, omit `--create-bucket-configuration` entirely — the API rejects it there.

Block public access, enable encryption, and expire objects after 7 days:

```bash
aws s3api put-public-access-block --bucket "$EXPORT_BUCKET_NAME" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$EXPORT_BUCKET_NAME" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

aws s3api put-bucket-lifecycle-configuration --bucket "$EXPORT_BUCKET_NAME" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "cloudtask-dev-exports-expire-7d",
      "Status": "Enabled",
      "Filter": {"Prefix": "exports/"},
      "Expiration": {"Days": 7},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}
    }]
  }'

aws s3api put-bucket-tagging --bucket "$EXPORT_BUCKET_NAME" \
  --tagging "TagSet=[{Key=Project,Value=cloudtask},{Key=Environment,Value=dev},{Key=Owner,Value=jubaer},{Key=ManagedBy,Value=ecs-express},{Key=Purpose,Value=aws-learning},{Key=CostCenter,Value=personal-learning},{Key=ExpiresOn,Value=$EXPIRES_ON}]"
```

### Verify

```bash
aws s3api get-public-access-block --bucket "$EXPORT_BUCKET_NAME" --output table
aws s3api get-bucket-lifecycle-configuration --bucket "$EXPORT_BUCKET_NAME" --output json
```

Expected: all four public-access flags are `true`, and the lifecycle rule expires the `exports/` prefix after 7 days.

The `exports/` prefix filter covers every object the application creates, because the worker writes only to `exports/{userId}/{exportId}.csv`. Presigned URLs are how users download them; the bucket itself is never public.

---

## 14. Secrets Manager

Exactly one application secret, holding only the two values that are genuinely secret. Region, queue URL, bucket name, and Redis host are **not** secrets and stay in plain environment variables — putting them here would make them harder to read and no safer.

```bash
export JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')

export APP_SECRET_ARN=$(aws secretsmanager create-secret \
  --name "$SECRET_NAME" \
  --description "CloudTask dev application secrets (DATABASE_URL, JWT_SECRET)" \
  --secret-string "$(python3 - <<'PY'
import json, os
print(json.dumps({
    "DATABASE_URL": os.environ["DATABASE_URL"],
    "JWT_SECRET":   os.environ["JWT_SECRET"],
}))
PY
)" \
  --tags $TAGS_EC2 \
  --region "$AWS_REGION" \
  --query ARN --output text)

echo "secret=$APP_SECRET_ARN"
```

Building the JSON with `python3` keeps the password correctly escaped and keeps the secret off your command line.

### Verify

```bash
aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" \
  --query SecretString --output text --region "$AWS_REGION" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sorted(d.keys()), {k: len(v) for k, v in d.items()})'
```

Expected: exactly `['DATABASE_URL', 'JWT_SECRET']`, with `JWT_SECRET` at least 16 characters — the API's configuration schema rejects anything shorter and refuses to boot.

---

# Part C — Images, IAM, logs, and the cluster

## 15. ECR repositories

```bash
for app in api worker web; do
  aws ecr create-repository \
    --repository-name "cloudtask-dev-${app}" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability IMMUTABLE \
    --tags $TAGS_EC2 \
    --region "$AWS_REGION" >/dev/null
  echo "created cloudtask-dev-${app}"
done
```

`IMMUTABLE` tags mean a given Git SHA can never be overwritten, so a deployed tag always identifies exactly one image. It also means re-pushing the same SHA fails: commit your changes, or use a different tag, rather than forcing a push.

**Do not use `latest` for deployments.** A mutable tag makes it impossible to tell which code is running, and makes a rollback ambiguous.

### Verify

```bash
aws ecr describe-repositories \
  --query 'repositories[?starts_with(repositoryName,`cloudtask-dev-`)].[repositoryName,imageTagMutability]' \
  --output table --region "$AWS_REGION"
```

Expected: three repositories, all `IMMUTABLE`.

---

## 16. Build and push the api and worker images

The web image is built later, in §24, because it needs the API's URL — which does not exist until the API service does.

### Step 16.1 — authenticate Docker to ECR

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"
```

### Step 16.2 — build and push

All three Dockerfiles take the **repository root** as build context, and the production stage is named `prod`.

```bash
docker build --platform linux/amd64 \
  -f apps/api/Dockerfile --target prod \
  -t "$ECR_REGISTRY/cloudtask-dev-api:$GIT_SHA" .

docker build --platform linux/amd64 \
  -f apps/worker/Dockerfile --target prod \
  -t "$ECR_REGISTRY/cloudtask-dev-worker:$GIT_SHA" .

docker push "$ECR_REGISTRY/cloudtask-dev-api:$GIT_SHA"
docker push "$ECR_REGISTRY/cloudtask-dev-worker:$GIT_SHA"
```

**Note:** `--platform linux/amd64` is required when building on Apple Silicon or any other arm64 machine. Fargate tasks in this runbook run on X86_64; an arm64 image fails at startup with `exec format error`, which surfaces confusingly as a health-check failure rather than as an architecture error.

**Note:** `.github/workflows/release.yml` already builds and pushes all three images via GitHub OIDC, on a matrix over `[api, worker, web]`, tagged with the full commit SHA. It is gated behind the repository variable `AWS_ROLE_ARN`. To let CI do this instead, set `AWS_ROLE_ARN`, `AWS_REGION`, and `NEXT_PUBLIC_API_BASE_URL` as repository variables. Note that the workflow needs the API URL at web build time too, so on a first deployment you still cannot build web before the API service exists.

### Verify

```bash
for app in api worker; do
  aws ecr describe-images --repository-name "cloudtask-dev-${app}" \
    --image-ids imageTag="$GIT_SHA" \
    --query 'imageDetails[0].[imageTags[0],imageSizeInBytes]' \
    --output text --region "$AWS_REGION"
done
```

Expected: both images exist, tagged with the current SHA.

---

## 17. CloudWatch log groups

Create the log groups before any service references them, with short retention so log storage cannot quietly accumulate cost.

```bash
for app in api worker web migrate; do
  aws logs create-log-group --log-group-name "/ecs/cloudtask-dev-${app}" \
    --tags "$TAGS_KV" --region "$AWS_REGION"
  aws logs put-retention-policy --log-group-name "/ecs/cloudtask-dev-${app}" \
    --retention-in-days 7 --region "$AWS_REGION"
done
```

### Verify

```bash
aws logs describe-log-groups --log-group-name-prefix /ecs/cloudtask-dev \
  --query 'logGroups[].[logGroupName,retentionInDays]' \
  --output table --region "$AWS_REGION"
```

Expected: four log groups, each with 7-day retention.

**Note:** this runbook uses `/ecs/cloudtask-dev-*`, matching `.github/workflows/release.yml`. `aws-deployment-lab-runbook-manual.md` uses `/cloudtask/dev/*`. The two conventions disagree; this runbook follows CI so log queries written here also work against pipeline deployments.

---

## 18. IAM roles

Four roles. Two are required by Express Mode itself; two are the application's own task roles from the specification's §15 least-privilege contract.

### Step 18.1 — the two roles Express Mode requires

```bash
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' --tags $TAGS_EC2

aws iam create-role --role-name ecsInfrastructureRoleForExpressServices \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "AllowAccessInfrastructureForECSExpressServices",
      "Effect": "Allow",
      "Principal": {"Service": "ecs.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' --tags $TAGS_EC2

aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam attach-role-policy --role-name ecsInfrastructureRoleForExpressServices \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
```

The **execution role** lets ECS pull images and write logs on your behalf. The **infrastructure role** lets ECS create and manage the load balancer, target groups, security groups, and auto scaling policies that Express Mode provisions. That second role is the entire reason one API call can build a production-shaped front end.

**Note:** if either role already exists from another lab, `create-role` fails with `EntityAlreadyExists`. That is harmless — skip to `attach-role-policy`, which is idempotent.

### Step 18.2 — let the execution role read the application secret

The managed execution-role policy does not grant Secrets Manager access. Without this, tasks fail to start with `ResourceInitializationError: unable to pull secrets or registry auth`.

```bash
aws iam put-role-policy --role-name ecsTaskExecutionRole \
  --policy-name cloudtask-dev-read-app-secret \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": ["${APP_SECRET_ARN}"]
  }]
}
JSON
)"
```

Scoped to the one secret ARN — not `*`, and not the whole `cloudtask/dev/*` prefix.

### Step 18.3 — the API task role

```bash
export TASK_TRUST='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ecs-tasks.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

export API_TASK_ROLE_ARN=$(aws iam create-role \
  --role-name cloudtask-dev-api-task-role \
  --assume-role-policy-document "$TASK_TRUST" \
  --tags $TAGS_EC2 --query 'Role.Arn' --output text)

aws iam put-role-policy --role-name cloudtask-dev-api-task-role \
  --policy-name cloudtask-dev-api-permissions \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnqueueExports",
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"],
      "Resource": ["${QUEUE_ARN}"]
    },
    {
      "Sid": "PresignExportDownloads",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::${EXPORT_BUCKET_NAME}/exports/*"]
    }
  ]
}
JSON
)"
```

The API only **enqueues** exports and **presigns** downloads. It cannot receive from the queue and cannot write to the bucket. §32 exercises what happens when this boundary is violated.

### Step 18.4 — the worker task role

```bash
export WORKER_TASK_ROLE_ARN=$(aws iam create-role \
  --role-name cloudtask-dev-worker-task-role \
  --assume-role-policy-document "$TASK_TRUST" \
  --tags $TAGS_EC2 --query 'Role.Arn' --output text)

aws iam put-role-policy --role-name cloudtask-dev-worker-task-role \
  --policy-name cloudtask-dev-worker-permissions \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeExports",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes"
      ],
      "Resource": ["${QUEUE_ARN}"]
    },
    {
      "Sid": "WriteExports",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::${EXPORT_BUCKET_NAME}/exports/*"]
    }
  ]
}
JSON
)"
```

The worker needs no CloudWatch permissions: it emits metrics as **CloudWatch EMF** lines on stdout, which the awslogs driver turns into metrics in the `CloudTask/Dev` namespace. There is no `PutMetricData` call to authorize.

The **web service needs no task role at all** — it makes no AWS API calls, only HTTP calls to the API.

### Verify

```bash
for r in ecsTaskExecutionRole ecsInfrastructureRoleForExpressServices \
         cloudtask-dev-api-task-role cloudtask-dev-worker-task-role; do
  echo "== $r"
  aws iam list-attached-role-policies --role-name "$r" \
    --query 'AttachedPolicies[].PolicyName' --output text
  aws iam list-role-policies --role-name "$r" --query 'PolicyNames' --output text
done
```

Expected: the execution role has the managed `AmazonECSTaskExecutionRolePolicy` plus one inline secret-read policy; the infrastructure role has `AmazonECSInfrastructureRoleforExpressGatewayServices`; each task role has exactly one inline policy and no managed policies. **No role has `AdministratorAccess`, no policy uses a wildcard resource, and no static access keys exist anywhere.**

**Note:** IAM is eventually consistent, so a newly created role may not be usable for up to about a minute. If your first `create-express-gateway-service` call fails with `Unable to assume the service linked role` or a similar assume-role error, wait and retry the identical command. AWS documents this behavior; it is not a misconfiguration.

---

## 19. ECS cluster

Express Mode defaults to a cluster named `default`. This runbook creates and nominates `cloudtask-dev` instead, so services are named consistently with the other three runbooks and so cleanup has one obvious cluster to delete.

```bash
aws ecs create-cluster --cluster-name "$CLUSTER" \
  --settings name=containerInsights,value=disabled \
  --tags $TAGS_ECS --region "$AWS_REGION"
```

Container Insights is off because it bills per metric, and this lab reads logs and EMF metrics instead. Turn it on if you want the deeper per-task view and accept the cost.

### Verify

```bash
aws ecs describe-clusters --clusters "$CLUSTER" \
  --query 'clusters[0].[clusterName,status,runningTasksCount]' \
  --output table --region "$AWS_REGION"
```

Expected: status `ACTIVE` with zero running tasks.

---

# Part D — Database initialization and the Express Mode services

The order in this Part is not arbitrary, and there is a dependency cycle in it worth understanding before you start:

1. The **schema** must exist before the API serves data, so migrations run first.
2. The **web image** needs the API's URL at *build* time, because `NEXT_PUBLIC_API_BASE_URL` is inlined by Next.js during `next build`. So the API service must exist before the web image can be built.
3. The **API** needs the web service's URL in `CORS_ORIGINS`, because Express Mode gives each service a different hostname and the browser therefore calls the API cross-origin. So the web service must exist before the API is fully configured.

That is a genuine cycle: api → web → api. It is resolved by creating the API with a placeholder CORS value and updating it in §25 once the web URL exists. Setting an environment variable is a cheap update; rebuilding an image is not, which is why the cycle is broken on the CORS side rather than the build side.

## 20. Register the migration task definition

Migrations do not run on application boot. Both the API and the worker set `synchronize: false` and `migrationsRun: false`, deliberately — schema changes are an explicit, single-writer operation, never a side effect of a task starting.

The production image cannot run the development migration command. `pnpm --filter @cloudtask/api migration:run` relies on `pnpm` and `ts-node`, and both are removed by `pnpm deploy --prod` when the `prod` stage is built. The command that works in the production image invokes the TypeORM CLI directly against the compiled data source:

```text
node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run
```

**Note:** `aws-deployment-lab-runbook-manual.md` §38 instructs you to override the container command with `pnpm --filter api migration:run`. That is wrong twice over — the package is `@cloudtask/api`, not `api`, and `pnpm`/`ts-node` do not exist in the production image. Use the command above.

Write the task definition, with the migration command baked in so there is nothing to override at run time:

```bash
cat > /tmp/cloudtask-migrate-taskdef.json <<JSON
{
  "family": "cloudtask-dev-migrate",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  },
  "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "migrate",
      "image": "${ECR_REGISTRY}/cloudtask-dev-api:${GIT_SHA}",
      "essential": true,
      "command": [
        "node", "node_modules/typeorm/cli.js",
        "-d", "dist/database/data-source.js",
        "migration:run"
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "${APP_SECRET_ARN}:DATABASE_URL::"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/cloudtask-dev-migrate",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
JSON

aws ecs register-task-definition \
  --cli-input-json file:///tmp/cloudtask-migrate-taskdef.json \
  --tags $TAGS_ECS --region "$AWS_REGION" \
  --query 'taskDefinition.[family,revision,cpu,memory]' --output table
```

**Note on units:** `register-task-definition` is the classic ECS API, and its `cpu`/`memory` values are unambiguously **CPU units and MiB** — `"512"` means half a vCPU and `"1024"` means 1 GiB. This is *not* necessarily the same convention as `create-express-gateway-service`, which is why §6.6 asks you to confirm that separately. Do not assume the two commands agree.

The `valueFrom` suffix `:DATABASE_URL::` selects a single JSON key from the secret. The two trailing colons are the empty version-stage and version-id fields, and both are required — `:DATABASE_URL` alone is a syntax error.

### Verify

```bash
aws ecs describe-task-definition --task-definition cloudtask-dev-migrate \
  --query 'taskDefinition.containerDefinitions[0].[command,secrets[0].name]' \
  --output json --region "$AWS_REGION"
```

Expected: the TypeORM CLI command exactly as above, and `DATABASE_URL` listed as a secret.

---

## 21. Run the database migration once

```bash
export MIGRATE_TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition cloudtask-dev-migrate \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_A,$SUBNET_B],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --tags $TAGS_ECS \
  --region "$AWS_REGION" \
  --query 'tasks[0].taskArn' --output text)

echo "migrate task: $MIGRATE_TASK_ARN"

aws ecs wait tasks-stopped --cluster "$CLUSTER" \
  --tasks "$MIGRATE_TASK_ARN" --region "$AWS_REGION"
```

`assignPublicIp=ENABLED` is required. Without it, the task sits in a public subnet with no route to ECR, times out pulling the image, and fails with `CannotPullContainerError`. This is the single consequence of choosing "no NAT Gateway" that you will meet most often.

### Verify

```bash
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$MIGRATE_TASK_ARN" \
  --query 'tasks[0].{Status:lastStatus,Exit:containers[0].exitCode,Reason:stoppedReason}' \
  --output table --region "$AWS_REGION"
```

Expected: `Status` is `STOPPED` and `Exit` is `0`. **Any other exit code means the schema was not created and you must not continue.** Read the logs:

```bash
aws logs tail /ecs/cloudtask-dev-migrate --since 15m --region "$AWS_REGION"
```

Expected: TypeORM reports four migrations executed — `CreateUsers`, `CreateProjects`, `CreateTasks`, `CreateExports`.

**Do not run migrations from every API task.** Concurrent migration runners race each other on the same schema. This one-off task is the only thing that should ever write DDL. If you later add an automated migration step to a pipeline, document it here and delete this manual step rather than keeping both.

---

## 22. Create the api Express Mode service

### Step 22.1 — write the container definition

`CORS_ORIGINS` is set to a placeholder here and corrected in §25, for the reason given at the top of this Part.

```bash
cat > /tmp/cloudtask-api-container.json <<JSON
{
  "image": "${ECR_REGISTRY}/cloudtask-dev-api:${GIT_SHA}",
  "containerPort": 3000,
  "awsLogsConfiguration": {
    "logGroup": "/ecs/cloudtask-dev-api",
    "logStreamPrefix": "ecs"
  },
  "environment": [
    {"name": "NODE_ENV",           "value": "production"},
    {"name": "PORT",               "value": "3000"},
    {"name": "REDIS_HOST",         "value": "${REDIS_HOST}"},
    {"name": "REDIS_PORT",         "value": "6379"},
    {"name": "REDIS_TLS_ENABLED",  "value": "true"},
    {"name": "AWS_REGION",         "value": "${AWS_REGION}"},
    {"name": "EXPORT_QUEUE_URL",   "value": "${EXPORT_QUEUE_URL}"},
    {"name": "EXPORT_BUCKET_NAME", "value": "${EXPORT_BUCKET_NAME}"},
    {"name": "LOG_LEVEL",          "value": "info"},
    {"name": "CORS_ORIGINS",       "value": "https://placeholder.invalid"}
  ],
  "secrets": [
    {"name": "DATABASE_URL", "valueFrom": "${APP_SECRET_ARN}:DATABASE_URL::"},
    {"name": "JWT_SECRET",   "valueFrom": "${APP_SECRET_ARN}:JWT_SECRET::"}
  ]
}
JSON
```

Four things about this environment block are load-bearing. Each one, if wrong, produces a failure that looks like something else:

- **`AWS_ENDPOINT_URL` is absent.** It must never be set in AWS. If present, the AWS SDK sends every SQS and S3 call to that endpoint — LocalStack, locally — and exports fail with connection errors that look like IAM problems.
- **`ENABLE_FAILURE_ENDPOINTS` is absent.** The API's configuration schema *rejects* `true` when `NODE_ENV=production`, and the process exits rather than booting. §34 does this on purpose.
- **`REDIS_TLS_ENABLED` is `"true"`**, because §11 enabled in-transit encryption.
- **`AWS_REGION`, `EXPORT_QUEUE_URL`, and `EXPORT_BUCKET_NAME` are all required** when `NODE_ENV=production`. The schema's `superRefine` fails the boot if any is missing, printing every problem at once.

### Step 22.2 — create the service

```bash
export API_SERVICE_ARN=$(aws ecs create-express-gateway-service \
  --service-name cloudtask-dev-api \
  --cluster "$CLUSTER" \
  --execution-role-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsTaskExecutionRole" \
  --task-role-arn "$API_TASK_ROLE_ARN" \
  --infrastructure-role-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsInfrastructureRoleForExpressServices" \
  --primary-container file:///tmp/cloudtask-api-container.json \
  --network-configuration "securityGroups=$TASK_SG,subnets=$SUBNET_A,$SUBNET_B" \
  --cpu 0.5 \
  --memory 1 \
  --health-check-path "/health" \
  --scaling-target minTaskCount=1,maxTaskCount=3,autoScalingMetric=AVERAGE_CPU,autoScalingTargetValue=60 \
  --tags $TAGS_ECS \
  --region "$AWS_REGION" \
  --query 'service.serviceArn' --output text)

echo "api service: $API_SERVICE_ARN"
```

**Note:** substitute `--cpu 512 --memory 1024` if §6.6 showed that your CLI expects CPU units and MiB.

**Note:** the AWS tutorial adds `--monitor-resources`, which streams provisioning progress until you interrupt it. That is useful when you are watching interactively, but it prevents capturing the service ARN into a variable, so this runbook polls instead. To watch a deployment live at any time, run `aws ecs monitor-express-gateway-service --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION"` in a second terminal. If your CLI version requires a value for the flag, pass `DEPLOYMENT`.

**Note:** if this call fails with `Unable to assume the service linked role`, the IAM roles from §18 have not finished propagating. Wait about a minute and re-run the identical command — see the note at the end of §18.

### Step 22.3 — wait for the service to become active

Provisioning a load balancer, target group, listener, and the first task takes several minutes.

```bash
until [ "$(aws ecs describe-express-gateway-service \
            --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
            --query 'service.status.statusCode' --output text)" = "ACTIVE" ]; do
  echo "waiting for api service..."; sleep 20
done
echo "api service is ACTIVE"
```

### Step 22.4 — record the assigned URL

```bash
aws ecs describe-express-gateway-service --service-arn "$API_SERVICE_ARN" \
  --region "$AWS_REGION" --output json
```

Read the service URL from that output and export it. On current API versions it is `service.url`:

```bash
export API_URL=$(aws ecs describe-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
  --query 'service.url' --output text)

# Strip any trailing slash so the base URL composes cleanly.
export API_URL="${API_URL%/}"
export API_BASE_URL="${API_URL}/api/v1"
echo "api url: $API_URL"
```

**Note:** if `service.url` returns `None`, the field is named differently in your API version. Read the full `describe-express-gateway-service` output from the command above and set `API_URL` by hand. The URL has the form `https://<service-name>.ecs.<region>.on.aws`. Do not guess it — a generated name may carry a random suffix, as in `https://cloudtask-dev-api-23d97h88.ecs.ap-south-1.on.aws`.

### Verify

```bash
curl -fsS "$API_URL/health" && echo
curl -fsS "$API_URL/ready"  && echo
curl -fsS -o /dev/null -w 'docs:%{http_code}\n' "$API_URL/docs"
```

Expected: `/health` returns `{"status":"ok"}`; `/ready` reports `ok` with both `database` and `redis` healthy; `/docs` returns `200`.

If `/ready` reports `degraded`, the database is reachable but Redis is not — check `REDIS_TLS_ENABLED` first, then the Redis security group. If `/ready` returns `503`, the database is unreachable; go to §38.

TLS is already working on this URL and you did not request, validate, or attach a certificate. That is Express Mode doing in one call what Part F of the manual runbook spends four sections on.

---

## 23. Confirm task networking and tighten the security group

§9 opened port 3000 to the whole VPC CIDR because the load balancer's security group did not exist yet. It does now.

### Step 23.1 — confirm the nominated security group is really attached

This verifies rather than assumes that `--network-configuration` was honored, which also tells you whether the RDS ingress rule from §9 can possibly be working.

```bash
export API_TASK_ARN=$(aws ecs list-tasks --cluster "$CLUSTER" \
  --service-name cloudtask-dev-api --desired-status RUNNING \
  --query 'taskArns[0]' --output text --region "$AWS_REGION")

export API_ENI=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$API_TASK_ARN" \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" \
  --output text --region "$AWS_REGION")

aws ec2 describe-network-interfaces --network-interface-ids "$API_ENI" \
  --query 'NetworkInterfaces[0].Groups[].[GroupId,GroupName]' \
  --output table --region "$AWS_REGION"
```

Expected: the list includes `$TASK_SG` (`cloudtask-dev-express-tasks-sg`). Express Mode may attach additional groups of its own alongside it; that is fine.

**If `$TASK_SG` is *not* listed**, then Express Mode used its own group instead and the RDS rule in §9 authorizes nothing that exists. The API would be failing to reach the database. Two options:

1. Add the group Express Mode actually attached as an authorized source on the RDS and Redis groups — read its ID from the table above and run the `authorize-security-group-ingress` commands from §9.2 again with `--source-group` set to that ID.
2. As a lab-only fallback, authorize the VPC CIDR: `aws ec2 authorize-security-group-ingress --group-id "$RDS_SG" --protocol tcp --port 5432 --cidr "$VPC_CIDR" --region "$AWS_REGION"`. This is wider than the specification allows and is acceptable only in a disposable lab.

### Step 23.2 — replace the VPC-wide rule with the load balancer's group

Find the security group Express Mode created for its load balancer:

```bash
export ALB_ARN=$(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --query 'LoadBalancers[?VpcId==`'"$VPC_ID"'`].LoadBalancerArn' --output text | head -n1)

export ALB_SG=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].SecurityGroups[0]' --output text --region "$AWS_REGION")

echo "alb=$ALB_ARN alb_sg=$ALB_SG"
```

Then swap the rule:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id "$TASK_SG" --protocol tcp --port 3000 \
  --source-group "$ALB_SG" --region "$AWS_REGION"

aws ec2 revoke-security-group-ingress \
  --group-id "$TASK_SG" --protocol tcp --port 3000 \
  --cidr "$VPC_CIDR" --region "$AWS_REGION"
```

### Verify

```bash
curl -fsS "$API_URL/health" && echo "still reachable through the load balancer"

aws ec2 describe-security-groups --group-ids "$TASK_SG" \
  --query 'SecurityGroups[0].IpPermissions[].{Port:FromPort,FromSG:UserIdGroupPairs[].GroupId,Cidr:IpRanges[].CidrIp}' \
  --output json --region "$AWS_REGION"
```

Expected: `/health` still returns `200`, and port 3000 is now reachable only from `$ALB_SG` with no CIDR-based rule remaining.

**Note:** if the account has more than one load balancer in the default VPC, the `head -n1` above may pick the wrong one. List them with `aws elbv2 describe-load-balancers --query 'LoadBalancers[].[LoadBalancerName,VpcId]' --output table` and set `ALB_ARN` explicitly. Express Mode **shares one load balancer across services with the same networking configuration**, so after §25 both api and web will sit behind this same one — that sharing is a deliberate cost optimization, and it is also why §42 warns that deleting one service does not delete the load balancer.

---

## 24. Build and push the web image against the API URL

`NEXT_PUBLIC_API_BASE_URL` is inlined into the JavaScript bundle by `next build`. It is a **build argument, not a runtime setting**. Setting it as an environment variable on the service has no effect whatsoever — the value is already compiled into the files the browser downloads.

```bash
echo "building web against: $API_BASE_URL"

docker build --platform linux/amd64 \
  -f apps/web/Dockerfile --target prod \
  --build-arg NEXT_PUBLIC_API_BASE_URL="$API_BASE_URL" \
  -t "$ECR_REGISTRY/cloudtask-dev-web:$GIT_SHA" .

docker push "$ECR_REGISTRY/cloudtask-dev-web:$GIT_SHA"
```

### Verify

Confirm the URL really was baked in, before deploying an image that silently points at `localhost`:

```bash
docker run --rm --entrypoint sh "$ECR_REGISTRY/cloudtask-dev-web:$GIT_SHA" \
  -c "grep -ro --include='*.js' -m1 'https://[a-z0-9.-]*\.on\.aws[^\"]*' /app/apps/web/.next/static | head -n3"
```

Expected: at least one match showing your API URL. If the output is empty, or if you see `http://localhost:3001`, the build argument did not reach `next build` — check that you passed `--build-arg` and that `$API_BASE_URL` was set in the shell that ran `docker build`.

**Note:** any future change to the API URL requires rebuilding and redeploying this image. It cannot be fixed with an environment variable update. If that coupling bothers you, the alternative is to serve both services behind one origin and use a relative base URL — which is exactly what `aws-deployment-lab-runbook-beanstalk.md` does, and a good reason to read that runbook next.

---

## 25. Create the web Express Mode service

### Step 25.1 — write the container definition

```bash
cat > /tmp/cloudtask-web-container.json <<JSON
{
  "image": "${ECR_REGISTRY}/cloudtask-dev-web:${GIT_SHA}",
  "containerPort": 3000,
  "awsLogsConfiguration": {
    "logGroup": "/ecs/cloudtask-dev-web",
    "logStreamPrefix": "ecs"
  },
  "environment": [
    {"name": "NODE_ENV", "value": "production"},
    {"name": "PORT",     "value": "3000"}
  ]
}
JSON
```

The web container needs no secrets, no AWS configuration, and no task role. It is a Next.js server that renders pages; every data call happens in the browser against the API URL compiled into the bundle.

### Step 25.2 — create the service

```bash
export WEB_SERVICE_ARN=$(aws ecs create-express-gateway-service \
  --service-name cloudtask-dev-web \
  --cluster "$CLUSTER" \
  --execution-role-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsTaskExecutionRole" \
  --infrastructure-role-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsInfrastructureRoleForExpressServices" \
  --primary-container file:///tmp/cloudtask-web-container.json \
  --network-configuration "securityGroups=$TASK_SG,subnets=$SUBNET_A,$SUBNET_B" \
  --cpu 0.5 \
  --memory 1 \
  --health-check-path "/" \
  --scaling-target minTaskCount=1,maxTaskCount=3,autoScalingMetric=AVERAGE_CPU,autoScalingTargetValue=60 \
  --tags $TAGS_ECS \
  --region "$AWS_REGION" \
  --query 'service.serviceArn' --output text)

until [ "$(aws ecs describe-express-gateway-service \
            --service-arn "$WEB_SERVICE_ARN" --region "$AWS_REGION" \
            --query 'service.status.statusCode' --output text)" = "ACTIVE" ]; do
  echo "waiting for web service..."; sleep 20
done

export WEB_URL=$(aws ecs describe-express-gateway-service \
  --service-arn "$WEB_SERVICE_ARN" --region "$AWS_REGION" \
  --query 'service.url' --output text)
export WEB_URL="${WEB_URL%/}"
echo "web url: $WEB_URL"
```

**Note on the health check path:** it is `/` and not `/healthz`. On this branch the web application has no dedicated health route — `apps/web/src/app/healthz/route.ts` exists only on the `infrastructure` branch. Health-checking `/` works but exercises a full page render, so it is heavier and slower than a purpose-built liveness route. If you want the lighter check, cherry-pick that route first and then use `--health-check-path "/healthz"`.

### Step 25.3 — close the CORS cycle

The API is still configured with the placeholder origin from §22, so the browser cannot call it from the web app. Correct it now that `$WEB_URL` exists:

```bash
python3 - <<'PY' > /tmp/cloudtask-api-container.json
import json, os
print(json.dumps({
    "image": f"{os.environ['ECR_REGISTRY']}/cloudtask-dev-api:{os.environ['GIT_SHA']}",
    "containerPort": 3000,
    "awsLogsConfiguration": {
        "logGroup": "/ecs/cloudtask-dev-api",
        "logStreamPrefix": "ecs",
    },
    "environment": [
        {"name": "NODE_ENV",           "value": "production"},
        {"name": "PORT",               "value": "3000"},
        {"name": "REDIS_HOST",         "value": os.environ["REDIS_HOST"]},
        {"name": "REDIS_PORT",         "value": "6379"},
        {"name": "REDIS_TLS_ENABLED",  "value": "true"},
        {"name": "AWS_REGION",         "value": os.environ["AWS_REGION"]},
        {"name": "EXPORT_QUEUE_URL",   "value": os.environ["EXPORT_QUEUE_URL"]},
        {"name": "EXPORT_BUCKET_NAME", "value": os.environ["EXPORT_BUCKET_NAME"]},
        {"name": "LOG_LEVEL",          "value": "info"},
        {"name": "CORS_ORIGINS",       "value": os.environ["WEB_URL"]},
    ],
    "secrets": [
        {"name": "DATABASE_URL", "valueFrom": f"{os.environ['APP_SECRET_ARN']}:DATABASE_URL::"},
        {"name": "JWT_SECRET",   "valueFrom": f"{os.environ['APP_SECRET_ARN']}:JWT_SECRET::"},
    ],
}, indent=2))
PY

aws ecs update-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" \
  --primary-container file:///tmp/cloudtask-api-container.json \
  --region "$AWS_REGION" \
  --query 'service.[serviceName,status.statusCode]' --output table
```

This triggers a canary deployment of the API, which takes several minutes to complete. §36 explains that behavior in detail. Wait for it:

```bash
until [ "$(aws ecs describe-express-gateway-service \
            --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
            --query 'service.status.statusCode' --output text)" = "ACTIVE" ]; do
  echo "waiting for api canary deployment..."; sleep 20
done
```

### Verify

```bash
curl -fsS -o /dev/null -w 'web:%{http_code}\n' "$WEB_URL/"

curl -fsS -o /dev/null -D - "$API_URL/api/v1/projects" \
  -H "Origin: $WEB_URL" 2>&1 | grep -i 'access-control-allow-origin' \
  || echo "NO CORS HEADER — check CORS_ORIGINS"
```

Expected: the web root returns `200`, and the API returns an `access-control-allow-origin` header echoing `$WEB_URL`. A `401` status on the projects call is correct and expected — the request is unauthenticated. You are checking the CORS header, not the status code.

---

# Part E — The worker service

The worker does not fit the Express Mode shape. Express Mode exists to put an HTTPS URL and a load balancer in front of a container; the worker has no HTTP port, serves no requests, and must never be internet-reachable. It long-polls SQS and writes to S3.

So the worker is created with the plain ECS APIs, in the same cluster, using the same security group and subnets. This contrast is the most useful thing in this runbook: **Express Mode covers web services, not workloads.** Any real system has both.

## 26. Register the worker task definition

```bash
cat > /tmp/cloudtask-worker-taskdef.json <<JSON
{
  "family": "cloudtask-dev-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  },
  "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsTaskExecutionRole",
  "taskRoleArn": "${WORKER_TASK_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "worker",
      "image": "${ECR_REGISTRY}/cloudtask-dev-worker:${GIT_SHA}",
      "essential": true,
      "stopTimeout": 120,
      "environment": [
        {"name": "NODE_ENV",                       "value": "production"},
        {"name": "AWS_REGION",                     "value": "${AWS_REGION}"},
        {"name": "EXPORT_QUEUE_URL",               "value": "${EXPORT_QUEUE_URL}"},
        {"name": "EXPORT_BUCKET_NAME",             "value": "${EXPORT_BUCKET_NAME}"},
        {"name": "SQS_WAIT_TIME_SECONDS",          "value": "20"},
        {"name": "SQS_VISIBILITY_TIMEOUT_SECONDS", "value": "60"},
        {"name": "LOG_LEVEL",                      "value": "info"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "${APP_SECRET_ARN}:DATABASE_URL::"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/cloudtask-dev-worker",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
JSON

aws ecs register-task-definition \
  --cli-input-json file:///tmp/cloudtask-worker-taskdef.json \
  --tags $TAGS_ECS --region "$AWS_REGION" \
  --query 'taskDefinition.[family,revision]' --output table
```

What is deliberately **absent** from the worker's configuration, and why:

- **No `PORT`** — it runs as a NestJS standalone application context, not an HTTP server.
- **No Redis settings** — the worker never connects to Redis. Adding `REDIS_HOST` here would be harmless but misleading; the specification calls this out repeatedly because it is a common wrong assumption.
- **No `JWT_SECRET`** — the worker authenticates nobody.
- **No `AWS_ENDPOINT_URL`** — as with the API, it must be unset in AWS.

`stopTimeout: 120` matters. On `SIGTERM` the worker stops polling, finishes the message it is currently processing, and exits `0`. The Fargate default of 30 seconds can kill it mid-export, which leaves the message to be redelivered. Two minutes gives a lab-sized export room to finish cleanly.

### Verify

```bash
aws ecs describe-task-definition --task-definition cloudtask-dev-worker \
  --query 'taskDefinition.containerDefinitions[0].{Stop:stopTimeout,Env:environment[].name,Secrets:secrets[].name}' \
  --output json --region "$AWS_REGION"
```

Expected: `stopTimeout` is 120, the environment list contains no `PORT`, no `REDIS_*`, and no `AWS_ENDPOINT_URL`, and `DATABASE_URL` is the only secret.

---

## 27. Create the worker service

No load balancer, no target group, no health-check path — there is nothing to health-check over HTTP.

```bash
aws ecs create-service \
  --cluster "$CLUSTER" \
  --service-name cloudtask-dev-worker \
  --task-definition cloudtask-dev-worker \
  --launch-type FARGATE \
  --desired-count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_A,$SUBNET_B],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --enable-execute-command \
  --tags $TAGS_ECS \
  --region "$AWS_REGION" \
  --query 'service.[serviceName,status,desiredCount]' --output table

aws ecs wait services-stable --cluster "$CLUSTER" \
  --services cloudtask-dev-worker --region "$AWS_REGION"
```

`--enable-execute-command` lets you open a shell inside a running worker task with `aws ecs execute-command`, which is the only practical way to inspect a container that has no HTTP surface. It requires the SSM plugin locally and adds `ssmmessages` permissions needs to the task role in stricter setups; if it fails, drop the flag and rely on logs.

### Verify

```bash
aws ecs describe-services --cluster "$CLUSTER" --services cloudtask-dev-worker \
  --query 'services[0].[status,desiredCount,runningCount,loadBalancers]' \
  --output json --region "$AWS_REGION"

aws logs tail /ecs/cloudtask-dev-worker --since 5m --region "$AWS_REGION"
```

Expected: status `ACTIVE`, `runningCount` is 1, `loadBalancers` is an empty list, and the logs show the SQS consumer starting to long-poll without errors.

Worker liveness has no HTTP probe. You infer it from queue depth and message age, which is why the alarms in §40 matter more for the worker than for either web service.

---

# Part F — Verification

## 28. End-to-end functional verification

A deployment is not finished because three services report `ACTIVE`. It is finished when a request travels the whole path: browser → API → Postgres → SQS → worker → S3 → presigned download.

Run this against the deployed API. It uses only the real API contract, so anything that fails here is a genuine defect in the deployment.

### Step 28.1 — register and log in

```bash
export TEST_EMAIL="lab-$(date -u +%s)@example.com"
export TEST_PASSWORD='LabPassword123!'

curl -fsS -X POST "$API_BASE_URL/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"displayName\":\"Lab User\"}" \
  | python3 -m json.tool

export TOKEN=$(curl -fsS -X POST "$API_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')

echo "token length: ${#TOKEN}"
```

Expected: registration returns `201` with `id`, `email`, and `displayName` and **no password hash**; the token is a non-empty JWT. A `500` here almost always means the schema is missing — re-check §21.

### Step 28.2 — create a project and a task

```bash
export PROJECT_ID=$(curl -fsS -X POST "$API_BASE_URL/projects" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Express Mode Lab","description":"Deployed via ECS Express Mode"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Verify the export pipeline","status":"todo","priority":"high"}' \
  | python3 -m json.tool

curl -fsS "$API_BASE_URL/projects/$PROJECT_ID/summary" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: the project and task are created, and the summary returns counts. The summary is the Redis-cached endpoint — call it twice and the second call should be measurably faster. If Redis is misconfigured it still returns correct data, just without caching, which is exactly the graceful degradation §31 exercises.

### Step 28.3 — request an export and watch the worker process it

This is the only step that exercises every component at once.

```bash
export EXPORT_ID=$(curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["exportId"])')

echo "export: $EXPORT_ID"

for i in $(seq 1 20); do
  STATUS=$(curl -fsS "$API_BASE_URL/exports/$EXPORT_ID" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  echo "attempt $i: $STATUS"
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && break
  sleep 5
done
```

Expected: the status moves `queued` → `processing` → `completed` within roughly 30 seconds. `POST` returns `202 Accepted`, not `200` — the work is asynchronous by design.

### Step 28.4 — download the export

```bash
export DOWNLOAD_URL=$(curl -fsS "$API_BASE_URL/exports/$EXPORT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["downloadUrl"])')

curl -fsS "$DOWNLOAD_URL" | head -n 5
```

Expected: a CSV with a header row and the task you created. The presigned URL is valid for 5 minutes; after that, request the export again to get a fresh one.

### Step 28.5 — confirm the object landed in S3

```bash
aws s3 ls "s3://$EXPORT_BUCKET_NAME/exports/" --recursive --region "$AWS_REGION"
```

Expected: one object at `exports/{userId}/{exportId}.csv`.

### Step 28.6 — confirm the web application serves and reaches the API

```bash
curl -fsS -o /dev/null -w 'root:%{http_code}\n'  "$WEB_URL/"
curl -fsS -o /dev/null -w 'login:%{http_code}\n' "$WEB_URL/login"
```

Then open `$WEB_URL` in a browser, register a user through the UI, create a project, and request an export. **Open the browser developer console.** This is the step that catches the two mistakes unique to this deployment path:

- A CORS error means `CORS_ORIGINS` on the API does not match `$WEB_URL` — re-run §25.3.
- Network calls going to `http://localhost:3001` mean the web image was built without the build argument — re-run §24.

### Step 28.7 — confirm the queue drained

```bash
aws sqs get-queue-attributes --queue-url "$EXPORT_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --output table --region "$AWS_REGION"

aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --output table --region "$AWS_REGION"
```

Expected: both counts on the main queue are `0`, and the DLQ is empty. **A non-empty DLQ at this point means an export failed silently** — read `/ecs/cloudtask-dev-worker` before continuing.

---

# Part G — Controlled failure drills

Each drill follows the same four-part shape: introduce the failure, observe the symptom, troubleshoot from the symptom, restore. Resist the urge to skip to the restore step — the diagnostic path is the point.

Record each drill in the journal format in §46: what you changed, what a user would see, what evidence CloudWatch gave you, how long detection took, and how long recovery took.

## 29. Drill 1 — stop the worker

The most common production failure shape: the synchronous path is perfectly healthy and the asynchronous one is dead.

### Introduce failure

```bash
aws ecs update-service --cluster "$CLUSTER" --service cloudtask-dev-worker \
  --desired-count 0 --region "$AWS_REGION" \
  --query 'service.[serviceName,desiredCount]' --output table
```

### Observe

Request an export and poll it:

```bash
export STUCK_EXPORT=$(curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["exportId"])')

curl -fsS "$API_BASE_URL/exports/$STUCK_EXPORT" -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

- The API is entirely healthy: `/health` and `/ready` both return `200`.
- The export request still returns `202 Accepted`. **Nothing reports an error.**
- The status stays `queued` forever, with `downloadUrl` null.
- Queue depth grows and message age climbs:

```bash
aws sqs get-queue-attributes --queue-url "$EXPORT_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateAgeOfOldestMessage \
  --output table --region "$AWS_REGION"
```

### Troubleshoot

Check in this order:

1. Is the export row stuck at `queued`? Then the API enqueued successfully and the consumer is the problem — not the API.
2. `ApproximateNumberOfMessages` greater than zero with a climbing `ApproximateAgeOfOldestMessage` confirms messages are arriving and nothing is consuming them.
3. `aws ecs describe-services --cluster "$CLUSTER" --services cloudtask-dev-worker --query 'services[0].[desiredCount,runningCount]'` — both zero.
4. If `desiredCount` were 1 but `runningCount` zero, the cause would be a crash loop instead; read `/ecs/cloudtask-dev-worker` and check `stoppedReason` on the most recent task.

The lesson: **no HTTP health check anywhere in this system can detect this failure.** Only queue-depth and message-age alarms can, which is why §40 creates them.

### Restore

```bash
aws ecs update-service --cluster "$CLUSTER" --service cloudtask-dev-worker \
  --desired-count 1 --region "$AWS_REGION" >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" \
  --services cloudtask-dev-worker --region "$AWS_REGION"

curl -fsS "$API_BASE_URL/exports/$STUCK_EXPORT" -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Expected: the backlog drains and the previously stuck export reaches `completed` without being re-requested. Nothing was lost — the queue held the work the whole time. That is the durability you paid SQS for.

---

## 30. Drill 2 — break the API health-check path

### Introduce failure

Point the health check at a path the API does not serve:

```bash
aws ecs update-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" \
  --health-check-path "/not-a-real-path" \
  --region "$AWS_REGION" \
  --query 'service.[serviceName,status.statusCode]' --output table
```

### Observe

- Tasks start, pass no health check, and are killed and replaced in a loop.
- The API URL begins returning `503` from the load balancer.
- Target health shows `unhealthy` with reason `Target.ResponseCodeMismatch`:

```bash
export TG_ARN=$(aws elbv2 describe-target-groups --region "$AWS_REGION" \
  --query 'TargetGroups[?VpcId==`'"$VPC_ID"'`].TargetGroupArn' --output text | head -n1)

aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' \
  --output table --region "$AWS_REGION"
```

- Application logs show the container starting normally and 404s arriving from the load balancer's health checker. **The application is fine; the check is wrong.**

### Troubleshoot

Check in this order:

1. Does the container log show a successful startup? If yes, the application is healthy and the check is misconfigured.
2. Do the log entries show 404s at a regular interval from a private IP? That is the health checker.
3. Compare the configured path against a path the API actually serves. `/health` and `/ready` are the only two, and both are deliberately excluded from the `api/v1` global prefix — so the correct path is `/health`, **not** `/api/v1/health`.

This is the single most common self-inflicted outage in ECS deployments, and it is worth internalizing that the prefix exclusion in `apps/api/src/main.ts` is what makes `/health` correct.

### Restore

```bash
aws ecs update-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" \
  --health-check-path "/health" \
  --region "$AWS_REGION" >/dev/null

until [ "$(aws ecs describe-express-gateway-service \
            --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
            --query 'service.status.statusCode' --output text)" = "ACTIVE" ]; do
  echo "recovering..."; sleep 20
done
curl -fsS "$API_URL/health" && echo
```

---

## 31. Drill 3 — remove Redis and prove graceful degradation

### Introduce failure

Do not delete the cluster — that is slow and expensive to undo. Break the network path instead:

```bash
aws ec2 revoke-security-group-ingress \
  --group-id "$REDIS_SG" --protocol tcp --port 6379 \
  --source-group "$TASK_SG" --region "$AWS_REGION"
```

### Observe

```bash
curl -fsS "$API_URL/ready" | python3 -m json.tool
curl -fsS "$API_BASE_URL/projects/$PROJECT_ID/summary" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

- `/ready` returns **HTTP 200** with status `degraded` — not 503. Redis is explicitly non-critical.
- `/health` is unaffected and still returns `ok`.
- The summary endpoint still returns **correct data**, just without caching.
- Rate limiting silently falls back to a per-process in-memory limiter, so limits become per-task rather than global.
- The load balancer keeps the tasks in service, because the health check is `/health`, not `/ready`.

### Troubleshoot

Check in this order:

1. `/ready` distinguishes the two dependencies. A `degraded` response tells you Redis specifically, without guessing.
2. Worker logs are silent — correct, because the worker never uses Redis. If you see Redis errors in the worker, something is misconfigured beyond this drill.
3. Verify the network path rather than the client: `aws elasticache describe-replication-groups --replication-group-id cloudtask-dev-redis --query 'ReplicationGroups[0].Status'`. If the cluster is `available`, the failure is the security group or TLS, not Redis.
4. If Redis is reachable but the API still degrades, check `REDIS_TLS_ENABLED`. With in-transit encryption on and that flag off, the symptom is identical to a blocked port.

### Restore

```bash
aws ec2 authorize-security-group-ingress \
  --group-id "$REDIS_SG" --protocol tcp --port 6379 \
  --source-group "$TASK_SG" --region "$AWS_REGION"
```

Wait for the client's retry backoff, then confirm:

```bash
sleep 30
curl -fsS "$API_URL/ready" | python3 -m json.tool
```

Expected: status returns to `ok` with no task restart. The API reconnects on its own — it was designed to treat Redis as optional.

---

## 32. Drill 4 — revoke the API's permission to enqueue

Tests the least-privilege boundary from §18.3 and shows what an IAM failure looks like from the outside.

### Introduce failure

```bash
aws iam delete-role-policy \
  --role-name cloudtask-dev-api-task-role \
  --policy-name cloudtask-dev-api-permissions
```

Force new tasks so the credential change takes effect promptly:

```bash
aws ecs update-express-gateway-service --service-arn "$API_SERVICE_ARN" \
  --region "$AWS_REGION" --query 'service.status.statusCode' --output text
```

### Observe

```bash
curl -sS -o /tmp/export-attempt.json -w 'status:%{http_code}\n' \
  -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
  -H "Authorization: Bearer $TOKEN"
cat /tmp/export-attempt.json
```

- The export request now fails with a `5xx` rather than `202`.
- `/health` and `/ready` both stay `200` — the failure is in one code path, not the process.
- API logs contain `AccessDenied` from SQS naming `sqs:SendMessage`.
- Queue depth does not increase, because nothing was ever enqueued.

### Troubleshoot

Check in this order:

1. Read the API log for the exact denied action and resource — IAM errors name both, so no guessing is needed.
2. `aws iam list-role-policies --role-name cloudtask-dev-api-task-role` — the policy is gone.
3. Confirm you are looking at the **task** role, not the **execution** role. The execution role pulls images and secrets before the container starts; the task role is what application code uses at run time. Failures in the first prevent startup; failures in the second produce a running service with broken features, exactly as here.

### Restore

Re-apply the policy from §18.3, then force a new deployment:

```bash
aws iam put-role-policy --role-name cloudtask-dev-api-task-role \
  --policy-name cloudtask-dev-api-permissions \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnqueueExports",
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"],
      "Resource": ["${QUEUE_ARN}"]
    },
    {
      "Sid": "PresignExportDownloads",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::${EXPORT_BUCKET_NAME}/exports/*"]
    }
  ]
}
JSON
)"

curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: `202` with a fresh `exportId`. Credentials are cached briefly, so allow a minute or force a new deployment if the first retry still fails.

---

## 33. Drill 5 — point the API at the wrong database

### Introduce failure

Store a deliberately wrong host in the secret, then redeploy so the new value is read. Secrets are resolved at container start, not continuously — that is itself worth seeing.

```bash
aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" \
  --secret-string "$(python3 - <<'PY'
import json, os
print(json.dumps({
    "DATABASE_URL": "postgres://cloudtask_admin:wrong@no-such-host.invalid:5432/cloudtask",
    "JWT_SECRET":   os.environ["JWT_SECRET"],
}))
PY
)" --region "$AWS_REGION" --query 'VersionId' --output text

aws ecs update-express-gateway-service --service-arn "$API_SERVICE_ARN" \
  --region "$AWS_REGION" --query 'service.status.statusCode' --output text
```

### Observe

- **The old tasks keep serving correctly** while the new ones fail. This is the canary deployment protecting you, and it is the most valuable thing to notice in this drill.
- New tasks fail their health checks and are replaced.
- `/ready` on any new task returns `503` with the database marked unhealthy.
- Logs show connection failures resolving `no-such-host.invalid`.
- The deployment does not complete, and rollback alarms eventually revert it.

```bash
aws logs tail /ecs/cloudtask-dev-api --since 10m --region "$AWS_REGION" | grep -i -m5 'error\|econnrefused\|enotfound'
```

### Troubleshoot

Check in this order:

1. Does `/ready` return 503 while `/health` returns 200? Then the process is running and a dependency is broken — the split between liveness and readiness is doing its job.
2. Read the log for the failing hostname. A DNS error points at the connection string; a timeout points at the security group; an authentication error points at the credentials.
3. Confirm what the secret currently holds — without printing it: `aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" --query SecretString --output text | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["DATABASE_URL"].split("@")[-1])'`. That prints only the host and database, never the password.
4. Verify the RDS endpoint independently and compare.

### Restore

```bash
aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" \
  --secret-string "$(python3 - <<'PY'
import json, os
print(json.dumps({
    "DATABASE_URL": os.environ["DATABASE_URL"],
    "JWT_SECRET":   os.environ["JWT_SECRET"],
}))
PY
)" --region "$AWS_REGION" --query 'VersionId' --output text

aws ecs update-express-gateway-service --service-arn "$API_SERVICE_ARN" \
  --region "$AWS_REGION" >/dev/null

until [ "$(aws ecs describe-express-gateway-service \
            --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
            --query 'service.status.statusCode' --output text)" = "ACTIVE" ]; do
  echo "recovering..."; sleep 20
done
curl -fsS "$API_URL/ready" | python3 -m json.tool
```

**Note:** `$DATABASE_URL` must still be set in your shell. If you have opened a new terminal since §10, re-derive it from §10.3 before running this.

---

## 34. Drill 6 — enable the failure endpoints in production

A configuration-validation drill. The application refuses to start rather than run in an unsafe configuration, and the deployment system must be able to tell you that clearly.

### Introduce failure

Add the forbidden variable to the API container definition and update the service:

```bash
python3 - <<'PY' > /tmp/cloudtask-api-broken.json
import json, os
cfg = json.load(open('/tmp/cloudtask-api-container.json'))
cfg['environment'].append({"name": "ENABLE_FAILURE_ENDPOINTS", "value": "true"})
print(json.dumps(cfg, indent=2))
PY

aws ecs update-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" \
  --primary-container file:///tmp/cloudtask-api-broken.json \
  --region "$AWS_REGION" --query 'service.status.statusCode' --output text
```

### Observe

- New tasks start and immediately exit. They never become healthy.
- Old tasks keep serving; the URL stays up throughout.
- Logs show the configuration validation failure and the process exiting, with every problem listed at once:

```bash
aws logs tail /ecs/cloudtask-dev-api --since 10m --region "$AWS_REGION" | grep -i -m10 'ENABLE_FAILURE_ENDPOINTS\|config\|invalid'
```

Expected: a message stating `ENABLE_FAILURE_ENDPOINTS must never be true in production`.

- The deployment stalls and eventually rolls back.

### Troubleshoot

Check in this order:

1. Tasks exiting within seconds of starting, with no HTTP traffic served, means startup failure — not a health-check or networking problem.
2. Read the first lines of the container log. A configuration schema failure prints all invalid variables at once, so one read gives the complete answer.
3. Compare the environment block against `packages/contracts/src/config/api-config.schema.ts`, which is the actual contract. `.env.example` documents it, but the schema enforces it.

The related trap: setting `AWS_ENDPOINT_URL` in AWS **does not** fail validation. The API boots happily and then sends every SQS and S3 call to LocalStack. That failure is far harder to diagnose than this one, which is why §22.1 calls it out explicitly.

### Restore

```bash
aws ecs update-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" \
  --primary-container file:///tmp/cloudtask-api-container.json \
  --region "$AWS_REGION" >/dev/null

until [ "$(aws ecs describe-express-gateway-service \
            --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
            --query 'service.status.statusCode' --output text)" = "ACTIVE" ]; do
  echo "recovering..."; sleep 20
done
curl -fsS "$API_URL/health" && echo
```

---

## 35. Drill 7 — fill the dead-letter queue

### Introduce failure

Take away the worker's ability to write to S3, so every export fails after the message has already been received. With `maxReceiveCount` 3, each message is retried three times and then moved to the DLQ.

```bash
aws iam delete-role-policy \
  --role-name cloudtask-dev-worker-task-role \
  --policy-name cloudtask-dev-worker-permissions

aws ecs update-service --cluster "$CLUSTER" --service cloudtask-dev-worker \
  --force-new-deployment --region "$AWS_REGION" >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" \
  --services cloudtask-dev-worker --region "$AWS_REGION"
```

Then request a few exports:

```bash
for i in 1 2 3; do
  curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
    -H "Authorization: Bearer $TOKEN" >/dev/null
done
```

### Observe

- Export requests still return `202`. The user sees no error at request time.
- Exports move to `processing` and then stall or report `failed`.
- Worker logs show repeated `AccessDenied` on `s3:PutObject`, three attempts per message.
- After roughly three visibility timeouts, messages land in the DLQ:

```bash
aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --output table --region "$AWS_REGION"
```

### Troubleshoot

Check in this order:

1. A non-empty DLQ means messages were received and failed repeatedly — distinct from Drill 1, where messages were never received at all. Queue depth versus DLQ depth tells you which failure you have.
2. Read the worker log for the denied action and resource.
3. Confirm the message count matches your request count times one — each message is one export, retried three times, then moved once.
4. Check the `exports` table status via the API. Idempotency means a redriven message can still succeed later without duplicating work.

### Restore

Re-apply the worker policy from §18.4, restart the worker, then redrive the DLQ:

```bash
aws iam put-role-policy --role-name cloudtask-dev-worker-task-role \
  --policy-name cloudtask-dev-worker-permissions \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeExports",
      "Effect": "Allow",
      "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"],
      "Resource": ["${QUEUE_ARN}"]
    },
    {
      "Sid": "WriteExports",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::${EXPORT_BUCKET_NAME}/exports/*"]
    }
  ]
}
JSON
)"

aws ecs update-service --cluster "$CLUSTER" --service cloudtask-dev-worker \
  --force-new-deployment --region "$AWS_REGION" >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" \
  --services cloudtask-dev-worker --region "$AWS_REGION"

aws sqs start-message-move-task \
  --source-arn "$DLQ_ARN" --region "$AWS_REGION"
```

### Verify

```bash
sleep 45
aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --output table --region "$AWS_REGION"
aws s3 ls "s3://$EXPORT_BUCKET_NAME/exports/" --recursive --region "$AWS_REGION"
```

Expected: the DLQ drains to zero and the previously failed exports appear in S3. The redrive is the operational muscle worth remembering — a DLQ is a repair queue, not a graveyard.

---

## 36. Drill 8 — deploy a broken image and watch the canary roll back

This drill has no equivalent in the manual or Terraform runbooks. It is the clearest demonstration of what the infrastructure role bought you.

Express Mode deploys updates as canary deployments by default:

- a new environment is created and tasks are deployed with your change
- 5% of traffic shifts to the new environment
- rollback triggers if the combined 4xx and 5xx error rate exceeds 1% for 2 datapoints within 3 minutes
- health checks verify the new tasks
- after a 3-minute bake, 100% of traffic shifts
- after a further 3-minute bake, old tasks are gradually stopped

### Introduce failure

Deploy an image that starts but cannot serve. Overriding the command to a process that exits immediately is the cleanest way to do it without building anything:

```bash
python3 - <<'PY' > /tmp/cloudtask-api-crash.json
import json
cfg = json.load(open('/tmp/cloudtask-api-container.json'))
cfg['command'] = ["node", "-e", "process.exit(1)"]
print(json.dumps(cfg, indent=2))
PY

aws ecs update-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" \
  --primary-container file:///tmp/cloudtask-api-crash.json \
  --region "$AWS_REGION" --query 'service.status.statusCode' --output text
```

### Observe

Watch the deployment live in a second terminal:

```bash
aws ecs monitor-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION"
```

Meanwhile, poll continuously from your first terminal:

```bash
for i in $(seq 1 60); do
  printf '%s ' "$(date -u +%T)"
  curl -sS -o /dev/null -w '%{http_code}\n' "$API_URL/health"
  sleep 10
done
```

- **The URL keeps returning `200` for the entire drill.** New tasks never pass their health check, so they never receive meaningful traffic.
- The deployment does not progress past the canary stage.
- The service eventually reverts to the previous revision on its own.

### Troubleshoot

Check in this order:

1. `describe-express-gateway-service` shows the deployment state and which revision is primary. If the primary is still the old revision after the deployment "finished", it rolled back.
2. Read `/ecs/cloudtask-dev-api` for the newest log streams — the failing tasks are there, separate from the healthy ones.
3. Contrast with `aws-deployment-lab-runbook-beanstalk.md` §27, where the same class of failure takes the environment down and requires you to manually redeploy a previous version. Canary rollback is not universal; it is a property of this platform.

### Restore

Usually nothing to do — the rollback is automatic. Confirm and, if the broken definition is still primary, push the good one:

```bash
aws ecs update-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" \
  --primary-container file:///tmp/cloudtask-api-container.json \
  --region "$AWS_REGION" >/dev/null

until [ "$(aws ecs describe-express-gateway-service \
            --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
            --query 'service.status.statusCode' --output text)" = "ACTIVE" ]; do
  echo "recovering..."; sleep 20
done
curl -fsS "$API_URL/health" && echo
```

---

## 37. Drills that do not apply to this deployment path

The manual and Terraform runbooks include eleven failure experiments. Four of them cannot be performed here, and understanding *why* is as useful as running the ones that can.

| Drill in the other runbooks | Why it does not apply here |
|---|---|
| Delete or misconfigure a listener rule | Express Mode owns the listener and does not expose rule configuration. There are no path rules — each service has its own hostname. |
| Detach a target group / change target type | Target groups are created and managed by the infrastructure role. Editing them by hand fights the service, which will reconcile your change away. |
| Delete the NAT Gateway | There is no NAT Gateway — §3 explains the deliberate choice of public subnets with public task IPs. The analogous failure here is removing `assignPublicIp`, which breaks ECR pulls. |
| Break the ALB security group | Possible but pointless: the infrastructure role reconciles the group back to its intended state, so the failure self-heals and teaches nothing. |

The general principle: **you cannot run a failure drill against a component you do not own.** Managed abstractions remove whole categories of outage, and they remove your ability to practice for them. That trade is the reason to know both.

---

# Part H — Troubleshooting framework

## 38. Troubleshooting decision tree

Work from the user-visible symptom inward. Every branch ends in a specific command, not a suggestion to look around.

### The service URL does not respond at all

```text
1. Is the service ACTIVE?
   aws ecs describe-express-gateway-service --service-arn <arn> \
     --query 'service.status' --output json
2. Are tasks running?
   aws ecs list-tasks --cluster cloudtask-dev --service-name <name> --desired-status RUNNING
3. Are targets healthy?
   aws elbv2 describe-target-health --target-group-arn <tg-arn>
4. If tasks are running but targets are unhealthy -> health-check path or port. See §30.
5. If no tasks are running -> read stoppedReason:
   aws ecs describe-tasks --cluster cloudtask-dev --tasks <arn> \
     --query 'tasks[0].[stoppedReason,containers[0].reason]'
```

### Tasks start and immediately stop

```text
CannotPullContainerError
  -> assignPublicIp is DISABLED, or the execution role cannot reach ECR.
     Confirm the task is in a public subnet with a public IP.
ResourceInitializationError: unable to pull secrets
  -> the execution role lacks secretsmanager:GetSecretValue. See §18.2.
exec format error
  -> the image was built for arm64. Rebuild with --platform linux/amd64. See §16.
Exit code 1 within seconds, config errors in the log
  -> a configuration schema violation. See §34.
OutOfMemoryError / exit code 137
  -> raise --memory, and re-read §6.6 in case the units are not what you assumed.
```

### `/health` returns 200 but `/ready` does not

```text
503 + database unhealthy
  -> DATABASE_URL wrong, RDS unavailable, or the RDS security group does not
     allow the group actually attached to the task. See §23.1 and §33.
200 + status "degraded"
  -> Redis only. Check REDIS_TLS_ENABLED first, then the Redis security group.
     This is expected behavior, not an outage. See §31.
```

### The API works but exports never complete

```text
1. What does GET /exports/:id report?
   queued      -> nothing consumed the message. Check the worker. See §29.
   processing  -> the worker picked it up and stalled. Read the worker log.
   failed      -> read errorCode, then the worker log.
2. Queue depth high, DLQ empty      -> no consumer running. See §29.
3. Queue depth low, DLQ non-empty   -> the consumer is failing. See §35.
4. Both empty but the status is queued -> the API never enqueued. See §32.
```

### The web application loads but shows no data

```text
1. Open the browser console. This is not optional; the cause is almost always visible there.
2. CORS error
   -> CORS_ORIGINS on the API does not include the web URL. See §25.3.
3. Requests going to localhost:3001
   -> the web image was built without --build-arg NEXT_PUBLIC_API_BASE_URL. See §24.
4. 401 on every request
   -> expected before login. Log in and retry before investigating further.
5. Requests reaching the API and returning 5xx
   -> this is an API problem, not a web problem. Start from the API branches above.
```

### Where to look, by evidence type

```text
Application behavior        -> /ecs/cloudtask-dev-{api,web,worker}
Why a task stopped          -> ecs describe-tasks: stoppedReason, containers[].reason
Whether traffic arrives     -> elbv2 describe-target-health
Async backlog               -> sqs get-queue-attributes on the queue and the DLQ
Worker throughput           -> CloudWatch namespace CloudTask/Dev (EMF from stdout)
Deployment progress         -> ecs monitor-express-gateway-service
What Express Mode created   -> elbv2 describe-load-balancers / describe-target-groups
```

---

# Part I — Observability

## 39. Take inventory of what Express Mode created

Express Mode's transparency claim is that every resource is a normal resource in your account, visible and manageable. Verify that rather than trusting it — and in doing so, find out exactly what one API call built.

### Step 39.1 — enumerate the managed resources

```bash
echo "== Load balancers"
aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --query 'LoadBalancers[?VpcId==`'"$VPC_ID"'`].[LoadBalancerName,Type,Scheme,State.Code]' \
  --output table

echo "== Listeners"
aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --region "$AWS_REGION" \
  --query 'Listeners[].[Port,Protocol,SslPolicy]' --output table

echo "== Target groups"
aws elbv2 describe-target-groups --region "$AWS_REGION" \
  --query 'TargetGroups[?VpcId==`'"$VPC_ID"'`].[TargetGroupName,Port,Protocol,TargetType,HealthCheckPath]' \
  --output table

echo "== Auto scaling policies"
aws application-autoscaling describe-scaling-policies \
  --service-namespace ecs --region "$AWS_REGION" \
  --query 'ScalingPolicies[].[PolicyName,ResourceId,PolicyType]' --output table

echo "== Services in the cluster"
aws ecs list-services --cluster "$CLUSTER" --region "$AWS_REGION" --output table
```

Expected: one internet-facing Application Load Balancer with an HTTPS listener and a TLS security policy you never chose; two target groups with the health-check paths you set; target-tracking scaling policies for both Express services; and three services in the cluster — two Express and one plain.

Count the resources. Then count the sections of `aws-deployment-lab-runbook-manual.md` Part F that create the same things by hand. That difference is what the infrastructure role did for you.

### Step 39.2 — confirm tag propagation

§3 promised to verify rather than assume that your tags reached the resources Express Mode created.

```bash
aws elbv2 describe-tags --resource-arns "$ALB_ARN" --region "$AWS_REGION" \
  --query 'TagDescriptions[0].Tags[].[Key,Value]' --output table

aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=cloudtask \
  --region "$AWS_REGION" \
  --query 'ResourceTagMappingList[].ResourceARN' --output table
```

Expected: the load balancer carries the seven mandatory tags, and the tag-based inventory lists every resource you created in this lab.

**If the load balancer is untagged**, tag propagation did not happen for managed resources. Tag it by hand so cost allocation and cleanup verification still work:

```bash
aws elbv2 add-tags --resource-arns "$ALB_ARN" --tags $TAGS_ECS --region "$AWS_REGION"
```

Record which behavior you observed in your lab journal — it determines whether tag-driven cost reports can account for the load balancer at all.

### Step 39.3 — confirm the EMF metrics arrived

The worker writes CloudWatch Embedded Metric Format lines to stdout. The awslogs driver turns them into real metrics with no `PutMetricData` call and no IAM permission.

```bash
aws cloudwatch list-metrics --namespace CloudTask/Dev --region "$AWS_REGION" \
  --query 'Metrics[].[MetricName,Dimensions[0].Value]' --output table
```

Expected: `ExportsCompleted`, `ExportProcessingDurationMs`, and — if you ran §35 — `ExportsFailed`.

If the namespace is empty, no export has completed yet. Run §28.3 once and re-check; metrics appear only after real work.

---

## 40. Add the alarms Express Mode does not create

Express Mode creates rollback alarms for its own deployment decisions. It does **not** create alarms that tell *you* the system is unhealthy, and it creates nothing at all for the worker — which §29 showed is precisely where the invisible failures live.

These are the five alarms from `application-spec.md` §14.

### Step 40.1 — create the notification topic

```bash
export ALERT_TOPIC_ARN=$(aws sns create-topic --name cloudtask-dev-alerts \
  --tags $TAGS_EC2 --region "$AWS_REGION" --query TopicArn --output text)

aws sns subscribe --topic-arn "$ALERT_TOPIC_ARN" \
  --protocol email --notification-endpoint jubaer@subrite.no \
  --region "$AWS_REGION" --query SubscriptionArn --output text
```

**Note:** confirm the subscription from your email before relying on it. An unconfirmed subscription silently delivers nothing, which makes every alarm below decorative.

### Step 40.2 — the two alarms that catch worker failure

These are the important ones. Neither has an HTTP equivalent.

```bash
export ALB_DIM=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text --region "$AWS_REGION" \
  | sed 's|.*loadbalancer/||')

# Oldest message age > 300s: the queue is backing up. Catches Drill 1.
aws cloudwatch put-metric-alarm \
  --alarm-name cloudtask-dev-export-queue-age \
  --alarm-description "Export queue oldest message older than 5 minutes" \
  --namespace AWS/SQS --metric-name ApproximateAgeOfOldestMessage \
  --dimensions Name=QueueName,Value=cloudtask-dev-export-queue \
  --statistic Maximum --period 60 --evaluation-periods 5 \
  --threshold 300 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$ALERT_TOPIC_ARN" \
  --tags $TAGS_EC2 --region "$AWS_REGION"

# Anything in the DLQ at all. Catches Drill 7.
aws cloudwatch put-metric-alarm \
  --alarm-name cloudtask-dev-export-dlq-not-empty \
  --alarm-description "Messages present in the export dead-letter queue" \
  --namespace AWS/SQS --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=cloudtask-dev-export-dlq \
  --statistic Maximum --period 300 --evaluation-periods 1 \
  --threshold 0 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$ALERT_TOPIC_ARN" \
  --tags $TAGS_EC2 --region "$AWS_REGION"
```

### Step 40.3 — the three infrastructure alarms

```bash
# ALB 5xx from targets.
aws cloudwatch put-metric-alarm \
  --alarm-name cloudtask-dev-alb-target-5xx \
  --alarm-description "More than 5 target 5xx responses in 5 minutes" \
  --namespace AWS/ApplicationELB --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value="$ALB_DIM" \
  --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 5 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$ALERT_TOPIC_ARN" \
  --tags $TAGS_EC2 --region "$AWS_REGION"

# Worker running task count below 1. The worker has no health check, so this
# is the only thing that notices it is gone.
aws cloudwatch put-metric-alarm \
  --alarm-name cloudtask-dev-worker-not-running \
  --alarm-description "Worker service has no running tasks" \
  --namespace ECS/ContainerInsights --metric-name RunningTaskCount \
  --dimensions Name=ClusterName,Value="$CLUSTER" Name=ServiceName,Value=cloudtask-dev-worker \
  --statistic Minimum --period 60 --evaluation-periods 2 \
  --threshold 1 --comparison-operator LessThanThreshold \
  --treat-missing-data breaching \
  --alarm-actions "$ALERT_TOPIC_ARN" \
  --tags $TAGS_EC2 --region "$AWS_REGION"

# RDS CPU.
aws cloudwatch put-metric-alarm \
  --alarm-name cloudtask-dev-rds-cpu-high \
  --alarm-description "RDS CPU above 80 percent for 10 minutes" \
  --namespace AWS/RDS --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=cloudtask-dev-postgres \
  --statistic Average --period 300 --evaluation-periods 2 \
  --threshold 80 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$ALERT_TOPIC_ARN" \
  --tags $TAGS_EC2 --region "$AWS_REGION"
```

**Note:** `RunningTaskCount` in the `ECS/ContainerInsights` namespace requires Container Insights, which §19 disabled to avoid its per-metric cost. This alarm will sit in `INSUFFICIENT_DATA` unless you enable it:

```bash
aws ecs update-cluster-settings --cluster "$CLUSTER" \
  --settings name=containerInsights,value=enabled --region "$AWS_REGION"
```

Decide deliberately: enable Container Insights and pay for it, or accept that the queue-age alarm in §40.2 is your only worker-failure signal. The queue-age alarm is arguably the better one anyway — it detects a worker that is running but stuck, which a task count cannot.

### Verify

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix cloudtask-dev \
  --query 'MetricAlarms[].[AlarmName,StateValue,ActionsEnabled]' \
  --output table --region "$AWS_REGION"
```

Expected: five alarms. All should be `OK` or `INSUFFICIENT_DATA` on a healthy idle system, with actions enabled.

Prove one works end to end before trusting any of them:

```bash
aws cloudwatch set-alarm-state \
  --alarm-name cloudtask-dev-export-dlq-not-empty \
  --state-value ALARM --state-reason "manual test of the notification path" \
  --region "$AWS_REGION"
```

Expected: an email arrives. An alarm that has never fired is a hypothesis, not a control.

---

# Part J — Cleanup

## 41. Cleanup overview

Delete in dependency order. The load balancer is the item most likely to be left behind and billed, because you never created it and it does not appear in the ECS console alongside your services.

```text
[ ] Delete the worker ECS service
[ ] Delete both Express Mode services (api, web)
[ ] Confirm the Application Load Balancer is gone
[ ] Delete the ECS cluster
[ ] Delete the RDS instance (and its automated backups)
[ ] Delete the ElastiCache replication group
[ ] Delete the DB and cache subnet groups
[ ] Empty and delete the S3 bucket
[ ] Delete both SQS queues
[ ] Delete the CloudWatch alarms and SNS topic
[ ] Delete the CloudWatch log groups
[ ] Delete the ECR repositories
[ ] Delete the Secrets Manager secret (force, no recovery window)
[ ] Delete the security groups
[ ] Delete the IAM roles and inline policies
[ ] Verify nothing project-tagged remains
[ ] Review the bill the next day
```

**Critical cost reminder:** work through this list in one sitting. A half-finished teardown is the most expensive state this lab can be left in, because the costly items — load balancer, RDS, Redis, public IPv4 addresses — are exactly the ones with no usage-based component. They bill whether you use them or not.

---

## 42. Delete the compute layer

### Step 42.1 — the worker service

```bash
aws ecs update-service --cluster "$CLUSTER" --service cloudtask-dev-worker \
  --desired-count 0 --region "$AWS_REGION" >/dev/null

aws ecs delete-service --cluster "$CLUSTER" --service cloudtask-dev-worker \
  --force --region "$AWS_REGION" --query 'service.[serviceName,status]' --output table
```

### Step 42.2 — the two Express Mode services

Deleting an Express service removes the service tasks, the target group, the auto scaling policies, the security groups it created, and — **when it is the last Express service using it** — the load balancer.

```bash
aws ecs delete-express-gateway-service \
  --service-arn "$WEB_SERVICE_ARN" --region "$AWS_REGION" \
  --query 'service.[serviceName,status.statusCode]' --output table

aws ecs delete-express-gateway-service \
  --service-arn "$API_SERVICE_ARN" --region "$AWS_REGION" \
  --query 'service.[serviceName,status.statusCode]' --output table
```

Deletion is not instantaneous. Wait for both to disappear:

```bash
until [ -z "$(aws ecs list-services --cluster "$CLUSTER" --region "$AWS_REGION" \
              --query 'serviceArns' --output text)" ]; do
  echo "waiting for services to delete..."; sleep 20
done
echo "all services deleted"
```

### Step 42.3 — confirm the load balancer is actually gone

**Do not skip this.** This is the single most likely resource to survive teardown and keep billing.

```bash
aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --query 'LoadBalancers[?VpcId==`'"$VPC_ID"'`].[LoadBalancerName,State.Code,CreatedTime]' \
  --output table
```

Expected: no load balancer belonging to this lab. If one remains, an Express service still references it, or one failed to delete. Re-check `aws ecs list-services --cluster "$CLUSTER"`, then delete the load balancer directly:

```bash
aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" --region "$AWS_REGION"
```

Also confirm no orphaned target groups remain:

```bash
aws elbv2 describe-target-groups --region "$AWS_REGION" \
  --query 'TargetGroups[?VpcId==`'"$VPC_ID"'`].[TargetGroupName,TargetGroupArn]' \
  --output table
```

### Step 42.4 — deregister task definitions and delete the cluster

```bash
for family in cloudtask-dev-worker cloudtask-dev-migrate; do
  for arn in $(aws ecs list-task-definitions --family-prefix "$family" \
                 --query 'taskDefinitionArns' --output text --region "$AWS_REGION"); do
    aws ecs deregister-task-definition --task-definition "$arn" \
      --region "$AWS_REGION" --query 'taskDefinition.[family,revision,status]' --output text
  done
done

aws ecs delete-cluster --cluster "$CLUSTER" --region "$AWS_REGION" \
  --query 'cluster.[clusterName,status]' --output table
```

**Note:** Express Mode also registers managed task definitions on your behalf, with names derived from the service names. Deregistered task definitions cost nothing, so leaving them is harmless — but list them so you know they exist: `aws ecs list-task-definitions --status ACTIVE --query 'taskDefinitionArns' --output table`.

---

## 43. Delete the data and messaging layer

### Step 43.1 — RDS

```bash
aws rds delete-db-instance \
  --db-instance-identifier cloudtask-dev-postgres \
  --skip-final-snapshot \
  --delete-automated-backups \
  --region "$AWS_REGION" \
  --query 'DBInstance.[DBInstanceIdentifier,DBInstanceStatus]' --output table

aws rds wait db-instance-deleted \
  --db-instance-identifier cloudtask-dev-postgres --region "$AWS_REGION"
```

`--skip-final-snapshot` and `--delete-automated-backups` are correct **only** for a disposable lab. Retained snapshots and automated backups bill after the instance is gone, and they are a classic surprise on the following month's bill. In any real environment you would keep the snapshot on purpose.

The AWS-managed master password secret is deleted with the instance. Confirm:

```bash
aws secretsmanager describe-secret --secret-id "$RDS_SECRET_ARN" \
  --region "$AWS_REGION" --query '[Name,DeletedDate]' --output table 2>/dev/null \
  || echo "master password secret already gone"
```

### Step 43.2 — ElastiCache

```bash
aws elasticache delete-replication-group \
  --replication-group-id cloudtask-dev-redis \
  --no-retain-primary-cluster \
  --region "$AWS_REGION" \
  --query 'ReplicationGroup.[ReplicationGroupId,Status]' --output table

aws elasticache wait replication-group-deleted \
  --replication-group-id cloudtask-dev-redis --region "$AWS_REGION"
```

### Step 43.3 — subnet groups

These must go after the resources that use them.

```bash
aws rds delete-db-subnet-group \
  --db-subnet-group-name cloudtask-dev-express-db-subnets --region "$AWS_REGION"

aws elasticache delete-cache-subnet-group \
  --cache-subnet-group-name cloudtask-dev-express-redis-subnets --region "$AWS_REGION"
```

### Step 43.4 — S3

A bucket must be empty before it can be deleted, including old versions if versioning was ever enabled.

```bash
aws s3 rm "s3://$EXPORT_BUCKET_NAME" --recursive --region "$AWS_REGION"
aws s3api delete-bucket --bucket "$EXPORT_BUCKET_NAME" --region "$AWS_REGION"
```

If deletion fails with `BucketNotEmpty`, remove non-current versions and delete markers:

```bash
aws s3api list-object-versions --bucket "$EXPORT_BUCKET_NAME" \
  --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json \
  > /tmp/versions.json
aws s3api delete-objects --bucket "$EXPORT_BUCKET_NAME" --delete file:///tmp/versions.json
aws s3api delete-bucket --bucket "$EXPORT_BUCKET_NAME" --region "$AWS_REGION"
```

### Step 43.5 — SQS

```bash
aws sqs delete-queue --queue-url "$EXPORT_QUEUE_URL" --region "$AWS_REGION"
aws sqs delete-queue --queue-url "$DLQ_URL" --region "$AWS_REGION"
```

**Note:** a deleted queue name cannot be recreated for 60 seconds. If you plan to re-run this lab immediately, expect that delay.

---

## 44. Delete monitoring, images, secrets, and IAM

### Step 44.1 — alarms, topic, and log groups

```bash
aws cloudwatch delete-alarms --alarm-names \
  cloudtask-dev-export-queue-age \
  cloudtask-dev-export-dlq-not-empty \
  cloudtask-dev-alb-target-5xx \
  cloudtask-dev-worker-not-running \
  cloudtask-dev-rds-cpu-high \
  --region "$AWS_REGION"

aws sns delete-topic --topic-arn "$ALERT_TOPIC_ARN" --region "$AWS_REGION"

for app in api worker web migrate; do
  aws logs delete-log-group --log-group-name "/ecs/cloudtask-dev-${app}" \
    --region "$AWS_REGION" && echo "deleted /ecs/cloudtask-dev-${app}"
done
```

Also delete any log groups Express Mode created on its own:

```bash
aws logs describe-log-groups --region "$AWS_REGION" \
  --query 'logGroups[?contains(logGroupName,`cloudtask`)].logGroupName' --output table
```

### Step 44.2 — ECR repositories

`--force` deletes the images along with the repository.

```bash
for app in api worker web; do
  aws ecr delete-repository --repository-name "cloudtask-dev-${app}" \
    --force --region "$AWS_REGION" --query 'repository.repositoryName' --output text
done
```

### Step 44.3 — the application secret

Secrets Manager schedules deletion with a 7-to-30-day recovery window by default, and **bills for the secret during that window**. Force immediate deletion:

```bash
aws secretsmanager delete-secret --secret-id "$SECRET_NAME" \
  --force-delete-without-recovery --region "$AWS_REGION" \
  --query '[Name,DeletionDate]' --output table
```

### Step 44.4 — security groups

Delete the dependent groups before the group they reference.

```bash
aws ec2 delete-security-group --group-id "$RDS_SG"   --region "$AWS_REGION"
aws ec2 delete-security-group --group-id "$REDIS_SG" --region "$AWS_REGION"
aws ec2 delete-security-group --group-id "$TASK_SG"  --region "$AWS_REGION"
```

If a delete fails with `DependencyViolation`, a network interface still exists. Fargate ENIs take a few minutes to disappear after the last task stops — wait and retry. To find the holder:

```bash
aws ec2 describe-network-interfaces \
  --filters Name=group-id,Values="$TASK_SG" \
  --query 'NetworkInterfaces[].[NetworkInterfaceId,Status,Description]' \
  --output table --region "$AWS_REGION"
```

### Step 44.5 — IAM roles

```bash
aws iam delete-role-policy --role-name cloudtask-dev-api-task-role \
  --policy-name cloudtask-dev-api-permissions 2>/dev/null
aws iam delete-role --role-name cloudtask-dev-api-task-role

aws iam delete-role-policy --role-name cloudtask-dev-worker-task-role \
  --policy-name cloudtask-dev-worker-permissions 2>/dev/null
aws iam delete-role --role-name cloudtask-dev-worker-task-role

aws iam delete-role-policy --role-name ecsTaskExecutionRole \
  --policy-name cloudtask-dev-read-app-secret 2>/dev/null
```

**Decide deliberately about the two shared roles.** `ecsTaskExecutionRole` and `ecsInfrastructureRoleForExpressServices` use AWS's conventional names, not `cloudtask-` names, and other labs or services in this account may depend on them. IAM roles are free. Leave them unless you are certain nothing else uses them:

```bash
# Only if you are sure.
aws iam detach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam delete-role --role-name ecsTaskExecutionRole

aws iam detach-role-policy --role-name ecsInfrastructureRoleForExpressServices \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
aws iam delete-role --role-name ecsInfrastructureRoleForExpressServices
```

---

## 45. Post-destroy verification

Run every check. A teardown you have not verified is a teardown that did not happen.

### 45.1 Load balancers

```bash
aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --query 'LoadBalancers[].[LoadBalancerName,VpcId]' --output table
```

Expected: no load balancer belonging to this lab.

### 45.2 Target groups

```bash
aws elbv2 describe-target-groups --region "$AWS_REGION" \
  --query 'TargetGroups[].[TargetGroupName]' --output table
```

Expected: no project target group.

### 45.3 ECS services, tasks, and clusters

```bash
aws ecs list-clusters --region "$AWS_REGION" --output table
aws ecs list-tasks --cluster "$CLUSTER" --region "$AWS_REGION" 2>/dev/null \
  || echo "cluster gone"
```

Expected: no `cloudtask-dev` cluster and no running tasks.

### 45.4 RDS instances, snapshots, and automated backups

```bash
aws rds describe-db-instances --region "$AWS_REGION" \
  --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus]' --output table
aws rds describe-db-snapshots --region "$AWS_REGION" --snapshot-type manual \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,AllocatedStorage]' --output table
aws rds describe-db-instance-automated-backups --region "$AWS_REGION" \
  --query 'DBInstanceAutomatedBackups[].[DBInstanceIdentifier,Status]' --output table
```

Expected: all three empty of project resources. **Snapshots and automated backups bill after the instance is gone** — this is the most commonly missed line item in the whole teardown.

### 45.5 ElastiCache

```bash
aws elasticache describe-replication-groups --region "$AWS_REGION" \
  --query 'ReplicationGroups[].[ReplicationGroupId,Status]' --output table
aws elasticache describe-cache-clusters --region "$AWS_REGION" \
  --query 'CacheClusters[].[CacheClusterId,CacheClusterStatus]' --output table
```

Expected: no project Redis resources.

### 45.6 Public IPv4 addresses and network interfaces

```bash
aws ec2 describe-addresses --region "$AWS_REGION" \
  --query 'Addresses[].[PublicIp,AssociationId]' --output table
aws ec2 describe-network-interfaces --region "$AWS_REGION" \
  --filters Name=vpc-id,Values="$VPC_ID" \
  --query 'NetworkInterfaces[].[NetworkInterfaceId,Status,Description]' --output table
```

Expected: no Elastic IPs from this lab, and no leftover ENIs described as belonging to ECS tasks. Public IPv4 addresses bill hourly whether attached or not.

### 45.7 S3 and SQS

```bash
aws s3 ls | grep cloudtask || echo "no cloudtask buckets"
aws sqs list-queues --queue-name-prefix cloudtask --region "$AWS_REGION" \
  --output table 2>/dev/null || echo "no cloudtask queues"
```

Expected: neither exists.

### 45.8 ECR, log groups, and secrets

```bash
aws ecr describe-repositories --region "$AWS_REGION" \
  --query 'repositories[].repositoryName' --output table 2>/dev/null \
  || echo "no repositories"
aws logs describe-log-groups --log-group-name-prefix /ecs/cloudtask \
  --region "$AWS_REGION" --query 'logGroups[].logGroupName' --output table
aws secretsmanager list-secrets --region "$AWS_REGION" \
  --query 'SecretList[?contains(Name,`cloudtask`)].[Name,DeletedDate]' --output table
```

Expected: no project repositories, no project log groups, and no project secrets — including none pending deletion.

### 45.9 Tag-based sweep

The single most useful check, because it does not depend on you remembering every resource type:

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=cloudtask \
  --region "$AWS_REGION" \
  --query 'ResourceTagMappingList[].ResourceARN' --output table
```

Expected: empty. Anything listed here still exists and may still bill.

**Note:** this sweep only finds resources that were tagged. If §39.2 showed that Express Mode did not propagate your tags, the load balancer will not appear here even if it survives — which is exactly why §45.1 checks it directly.

### 45.10 Billing review

Check **Billing and Cost Management → Cost Explorer** the day after teardown, grouped by service, filtered to this Region. Yesterday's usage should trend to zero. Anything still accruing is something the checks above missed.

---

## 46. Cleanup sign-off and lab journal

### Sign-off table

| Resource category | Expected after cleanup | Verified |
|---|---:|---|
| Application Load Balancer | none | [ ] |
| Target groups | none | [ ] |
| ECS services | none | [ ] |
| ECS cluster | deleted | [ ] |
| Fargate tasks | none running | [ ] |
| RDS instance | deleted | [ ] |
| RDS snapshots and automated backups | none | [ ] |
| ElastiCache replication group | deleted | [ ] |
| DB and cache subnet groups | deleted | [ ] |
| S3 export bucket | deleted | [ ] |
| SQS queue and DLQ | deleted | [ ] |
| CloudWatch alarms | deleted | [ ] |
| SNS topic | deleted | [ ] |
| CloudWatch log groups | deleted | [ ] |
| ECR repositories | deleted | [ ] |
| Secrets Manager secret | force-deleted | [ ] |
| Security groups | deleted | [ ] |
| IAM task roles | deleted | [ ] |
| Public IPv4 addresses | none | [ ] |
| Tag sweep for `Project=cloudtask` | empty | [ ] |
| Next-day billing review | trending to zero | [ ] |

### Recommended lab journal format

Record one entry per failure drill. The value of this lab is in the entries, not in the deployment.

```text
Experiment:
Date-time (UTC):
Change introduced:
Expected behavior:
Observed user symptom:
CloudWatch evidence:
Root cause:
Repair:
Time to detect:
Time to recover:
Preventive control:
```

Two questions worth answering in prose at the end, because they are the point of choosing this deployment path:

```text
Which failures did Express Mode prevent or recover from without my involvement?
Which failures did it make harder to see, because I no longer own the component?
```

---

## 47. Completion criteria

The lab is complete only when you can explain and demonstrate all of the following:

1. What `create-express-gateway-service` provisions on your behalf, and which of those resources you would otherwise create by hand — named specifically, from your §39.1 inventory.
2. Why the worker cannot be an Express Mode service, and what you used instead.
3. Why the web image had to be built after the API service existed, and why an environment-variable change cannot fix a wrong `NEXT_PUBLIC_API_BASE_URL`.
4. Why the API needed a second update after the web service existed, and how you broke the api → web → api dependency cycle.
5. The difference between `/health` and `/ready`, and why the load balancer checks the first and not the second.
6. Why a Redis outage produces `degraded` and HTTP 200 while a Postgres outage produces `503`.
7. Why no HTTP health check in this system can detect a stopped worker, and which alarm can.
8. The difference between the task execution role and the task role, in terms of the failure each one produces when broken.
9. What a canary rollback did for you in §36, and what the equivalent failure costs on Elastic Beanstalk.
10. Which failure drills from the manual runbook cannot be performed here, and why owning less infrastructure means practicing for fewer failures.
11. Every item in the §46 sign-off table verified, and the next-day bill trending to zero.

If you cannot answer these from your own notes rather than by re-reading this document, the drills in Part G are worth repeating.
