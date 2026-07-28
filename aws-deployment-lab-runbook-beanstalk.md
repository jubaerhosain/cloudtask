# CloudTask AWS Elastic Beanstalk Deployment, Failure-Testing, Troubleshooting, and Cleanup Runbook

## 1. Purpose

This runbook deploys the CloudTask application from `application-spec.md` to **AWS Elastic Beanstalk**, using the `Docker running on 64bit Amazon Linux 2023` platform branch with a `docker-compose.yml` bundle.

Elastic Beanstalk is a platform-as-a-service. You hand it a source bundle; it provisions EC2 instances, an Auto Scaling group, an Application Load Balancer, a CloudFormation stack, an S3 bucket for versions, and health monitoring. All four CloudTask containers — web, api, worker, and a reverse proxy — run **side by side on each instance**, which is a fundamentally different placement model from the one-service-per-task shape of the other three runbooks.

The objective is to understand the trade a PaaS makes: far less to configure, and a much blunter failure and scaling story. In particular, this runbook shows that **Elastic Beanstalk does not automatically roll back a failed container start** — a sharp contrast with the canary rollback in `aws-deployment-lab-runbook-ecs-express-mode.md`.

The lab sequence is:

1. Prepare and test the application locally.
2. Create the data and messaging layer (PostgreSQL, Redis, SQS, S3, Secrets Manager).
3. Create ECR repositories, the Elastic Beanstalk service role, and the instance profile.
4. Build the deployment bundle: compose file, reverse proxy, configuration, and platform hooks.
5. Reserve the environment hostname, then build and push the images.
6. Create the environment and deploy.
7. Initialize the database schema.
8. Validate the application end to end.
9. Introduce controlled failures.
10. Troubleshoot and restore the system.
11. Delete every costly resource.

---

## 2. Which runbook to use

CloudTask has four deployment runbooks. They build the **same application** on deliberately different foundations.

| Runbook | Provisioning method | What it teaches | What it hides |
|---|---|---|---|
| `aws-deployment-lab-runbook-manual.md` | AWS Console, by hand | Every wire: subnets, route tables, SGs, target groups, listener rules | Nothing |
| `aws-deployment-lab-runbook-terraform.md` | Terraform modules | Declarative infrastructure, state, drift, plan/apply discipline | Nothing, but expresses it as code |
| `aws-deployment-lab-runbook-ecs-express-mode.md` | AWS CLI + ECS Express Mode | Managed compute: what you still own vs. what AWS assumes | ALB, target groups, TLS, auto scaling, canary deployments |
| **this runbook** | EB CLI + Docker Compose | Platform-as-a-service: instance-hosted containers, enhanced health, versioned deploys | ALB, Auto Scaling group, EC2 provisioning, CloudFormation |

Read this one **after** the ECS Express Mode runbook if you can. The two are the most instructive pair in the set: both remove the load balancer from your responsibilities, but they make opposite choices about container placement, deployment safety, and what "unhealthy" means.

### Why the Docker branch and not the ECS-managed branch

Elastic Beanstalk offers two Docker platform branches. This runbook uses **`Docker running on 64bit AL2023`** with a `docker-compose.yml`.

The alternative, `ECS running on 64bit AL2023`, uses a `Dockerrun.aws.json` v2 file and maps more directly onto ECS task definitions. It looks like the obvious choice for a multi-container application, and AWS explicitly recommends against it for new work: *"If you don't have an Elastic Beanstalk environment running on an ECS based platform branch, we recommend you use the platform branch, Docker Running on 64bit AL2023. This offers a simpler approach and requires less resources."*

The ECS-managed branch exists as a migration path for people leaving the retired Multi-container Docker on Amazon Linux AMI platform. It is not the path for a new environment.

---

## 3. Proposed AWS architecture

```mermaid
flowchart TB
    User[Browser or API client]
    subgraph EB["Managed by Elastic Beanstalk"]
        ALB[Application Load Balancer\nHTTP:80]
        ASG[Auto Scaling group]
        subgraph Instance["Each EC2 instance — t3.small"]
            Proxy[nginx-proxy\nhost port 80]
            Web[web container\n:3000]
            Api[api container\n:3000]
            Worker[worker container\nno port]
        end
    end
    subgraph Owned["Created and owned by you"]
        RDS[(RDS PostgreSQL)]
        Redis[(ElastiCache Redis\nTLS)]
        SQS[SQS export queue + DLQ]
        S3[S3 export bucket]
        ECR[ECR repositories]
        SM[Secrets Manager]
    end

    User -->|HTTP| ALB
    ALB --> ASG
    ASG --> Proxy
    Proxy -->|/api/, /health, /ready, /docs| Api
    Proxy -->|everything else| Web
    Api --> RDS
    Api --> Redis
    Api --> SQS
    Worker --> RDS
    Worker --> SQS
    Worker --> S3
    SM -.->|fetched at bootstrap| Instance
    ECR -.->|docker pull| Instance
```

### How traffic reaches a container

This is the part of Elastic Beanstalk that surprises people, so it is worth stating precisely.

On the Docker platform with a `docker-compose.yml`, the container that publishes **host port 80** receives traffic directly from the load balancer. The platform's own reverse proxy is not in the path — your compose file owns port 80. This is exactly the shape of AWS's own Docker Compose quickstart, in which an nginx container publishes `80:80` and mounts `/var/log/nginx` so the platform can read its access logs.

So this runbook adds a fourth container, `nginx-proxy`, which does two jobs:

1. **Path routing**, reproducing the ALB listener rules from the manual runbook: `/api/`, `/health`, `/ready`, and `/docs` go to `api:3000`; everything else goes to `web:3000`.
2. **Enhanced health logging**, writing the `healthd` access-log format that Elastic Beanstalk's health agent reads to produce per-request latency and status-code percentiles.

The routing gives this deployment something no other runbook in this set has: **api and web share one origin.** That removes the cross-origin problem entirely, and it means `NEXT_PUBLIC_API_BASE_URL` can be the relative path `/api/v1`.

### How this differs from the specification architecture

Four deliberate deviations from `application-spec.md` §11–§15.

**1. Default VPC, no NAT Gateway.** As in the Express Mode runbook, this deployment uses the default VPC's public subnets. EC2 instances get public IPs for ECR, SQS, S3, and Secrets Manager access; RDS and ElastiCache stay non-public and are reachable only from the instance security group. **This is not the production topology** — see `aws-deployment-lab-runbook-ecs-express-mode.md` §3 for the full reasoning. The manual and Terraform runbooks build the three-tier VPC properly.

**2. All services on one instance.** The specification runs web, api, and worker as three independently scalable ECS services. Here they are three containers on every instance, so they scale together and share one instance's CPU and memory. Scaling for web traffic also scales the worker, whether or not the queue needs it. This is the central architectural cost of the PaaS model, and §31 makes it concrete.

**3. HTTP only, no TLS.** Express Mode hands you HTTPS for free. Elastic Beanstalk does not: an HTTPS listener needs an ACM certificate and a domain you control. This runbook stays on HTTP:80 because a lab does not have a domain. **Do not treat this as acceptable for anything real** — bearer tokens over plaintext HTTP are readable in transit.

**4. `ManagedBy=elastic-beanstalk`.** The specification's tagging contract uses `ManagedBy=terraform`. Resources here are tagged `ManagedBy=elastic-beanstalk`. Every other tag value matches the specification exactly.

---

## 4. Cost warning

This lab creates billable resources. In rough order of cost, delete these first:

- **EC2 instances** — `t3.small`, at least one, running continuously. Unlike Fargate you pay for the whole instance whether the containers are busy or idle.
- **Application Load Balancer** — created by Elastic Beanstalk for a load-balanced environment
- RDS database instance, plus any retained automated backups and snapshots
- ElastiCache Redis replication group
- Public IPv4 addresses attached to instances, billed hourly per address
- EBS volumes attached to the instances, and any snapshots
- The S3 bucket Elastic Beanstalk creates for application versions — it retains every version you ever deploy
- CloudWatch log storage, if you enable log streaming
- ECR image storage

Usually free as standalone objects, although traffic or related resources may cost money:

- Default VPC, subnets, route tables, Internet Gateway
- Security groups
- IAM roles, instance profiles, and policies
- The Elastic Beanstalk application object itself
- The CloudFormation stack
- SQS queues at lab volume

**Critical cost reminder:** `eb terminate` deletes the environment's own resources. It does **not** delete the RDS instance, ElastiCache cluster, S3 export bucket, SQS queues, ECR repositories, or Secrets Manager secret that you created in Part B — because Elastic Beanstalk never owned them. §35 covers both halves; do not stop after `eb terminate`.

Keep the environment for one lab session only unless you intentionally accept ongoing charges.

---

## 5. Mandatory tags

Add these tags to every taggable resource you create:

```text
Project=cloudtask
Environment=dev
Owner=jubaer
ManagedBy=elastic-beanstalk
Purpose=aws-learning
CostCenter=personal-learning
ExpiresOn=<YYYY-MM-DD>
```

`ManagedBy=elastic-beanstalk` is the one intentional difference from the specification's tagging contract, as explained in §3. Every other tag value matches the specification exactly.

### Tagging rule

Export the tag set once, in the shapes the different services expect:

```bash
export EXPIRES_ON=$(date -u -d '+2 days' +%F)   # macOS: date -u -v+2d +%F

# EC2, RDS, IAM, Secrets Manager: Key=,Value=
export TAGS_EC2="Key=Project,Value=cloudtask Key=Environment,Value=dev \
Key=Owner,Value=jubaer Key=ManagedBy,Value=elastic-beanstalk \
Key=Purpose,Value=aws-learning Key=CostCenter,Value=personal-learning \
Key=ExpiresOn,Value=$EXPIRES_ON"

# SQS, S3, CloudWatch Logs: comma-separated k=v
export TAGS_KV="Project=cloudtask,Environment=dev,Owner=jubaer,ManagedBy=elastic-beanstalk,Purpose=aws-learning,CostCenter=personal-learning,ExpiresOn=$EXPIRES_ON"

# eb create --tags: comma-separated k=v (same shape as TAGS_KV)
export TAGS_EB="$TAGS_KV"
```

Resources specific to this deployment path use a `cloudtask-dev-eb-` prefix so they cannot be confused with leftovers from the other runbooks.

**Note:** Elastic Beanstalk applies the tags you pass to `eb create` to the resources it creates, and adds its own `elasticbeanstalk:` tags. Tags cannot be added to an existing environment's resources retroactively through `eb`, so pass them at creation time.

---

# Part A — Before calling AWS

## 6. Account and region preparation

### Step 6.1 — choose one region

Select one AWS Region and use it for the whole lab. This runbook uses:

```text
ap-south-1
```

**Note:** creating resources in the wrong Region is the most common mistake in this lab. Every command below reads `$AWS_REGION`.

### Step 6.2 — account safety

1. Enable MFA for the root account.
2. Do not use the root account for the lab.
3. Use an IAM Identity Center user or a dedicated IAM user/role.
4. Do not put long-lived AWS access keys in source code.
5. Do not commit `.env` files.

### Step 6.3 — create a budget

Open **Billing and Cost Management → Budgets**, create a cost budget with a small monthly limit and email alerts. A budget alerts you; it does not stop resources.

### Step 6.4 — install the EB CLI

The EB CLI is separate from the AWS CLI and you need both.

```bash
python3 -m pip install --user awsebcli
eb --version
aws --version
```

Expected: both report a version. If `eb` is not found, add your Python user-scripts directory to `PATH` — typically `~/.local/bin`.

### Step 6.5 — set the shell variables this runbook uses

Every subsequent command depends on these. Set them in one shell and stay in it.

```bash
export AWS_REGION=ap-south-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export GIT_SHA=$(git rev-parse --short HEAD)
export EB_APP=cloudtask
export EB_ENV=cloudtask-dev
export EB_CNAME=cloudtask-dev
export SECRET_NAME=cloudtask/dev/application
```

### Verify

```bash
aws sts get-caller-identity --output table
echo "region=$AWS_REGION account=$AWS_ACCOUNT_ID sha=$GIT_SHA"
```

Expected: the identity is your lab user or role, **not** the root account, and no value is empty.

### Step 6.6 — find the current Docker platform branch

Platform branch names change as AWS releases updates. Read the current one rather than hardcoding it.

```bash
aws elasticbeanstalk list-available-solution-stacks --region "$AWS_REGION" \
  --query "SolutionStacks[?contains(@,'Docker')]" --output table
```

Expected: entries like `64bit Amazon Linux 2023 v4.x.y running Docker`. Pick the **highest version of the AL2023 Docker stack** — not an ECS one, and not an Amazon Linux 2 one:

```bash
export EB_PLATFORM=$(aws elasticbeanstalk list-available-solution-stacks --region "$AWS_REGION" \
  --query "SolutionStacks[?contains(@,'Amazon Linux 2023') && contains(@,'running Docker')] | [0]" \
  --output text)
echo "platform: $EB_PLATFORM"
```

Expected: a single AL2023 Docker stack name. Confirm it does **not** contain `ECS` — see §2 for why.

---

## 7. Local verification before deploying

Deploying an application you have not run locally turns one unknown into three.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then bring up the full local stack:

```bash
docker compose up --build -d
docker compose ps
```

Expected: `postgres`, `redis`, and `localstack` are healthy; `migrate` has exited `0`; `api`, `worker`, and `web` are running.

```bash
curl -fsS http://localhost:3001/health && echo
curl -fsS http://localhost:3001/ready  && echo
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3000/
pnpm --filter @cloudtask/api test:e2e
```

Expected: `/health` returns `{"status":"ok"}`, `/ready` reports `ok`, the web root returns `200`, and the end-to-end suite passes.

**Note:** the package name is `@cloudtask/api`, not `api`. An unscoped `--filter api` matches no package and silently runs nothing. There is also no root `test:integration` or root `test:e2e` script.

Tear the local stack down before moving to AWS:

```bash
docker compose down -v
```

---

## 8. Confirm the default VPC and choose subnets

```bash
export VPC_ID=$(aws ec2 describe-vpcs \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text --region "$AWS_REGION")
export VPC_CIDR=$(aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query 'Vpcs[0].CidrBlock' --output text --region "$AWS_REGION")

aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC_ID" \
  --query 'sort_by(Subnets,&AvailabilityZone)[].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]' \
  --output table --region "$AWS_REGION"
```

Choose two rows in **different** Availability Zones with `MapPublicIpOnLaunch` set to `True`:

```bash
export SUBNET_A=subnet-xxxxxxxxxxxxxxxxx
export SUBNET_B=subnet-yyyyyyyyyyyyyyyyy
export SUBNETS="${SUBNET_A},${SUBNET_B}"
echo "vpc=$VPC_ID cidr=$VPC_CIDR subnets=$SUBNETS"
```

### Verify

```bash
aws ec2 describe-subnets --subnet-ids "$SUBNET_A" "$SUBNET_B" \
  --query 'Subnets[].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]' \
  --output table --region "$AWS_REGION"
```

Expected: two subnets, two distinct Availability Zones, both `True`. An ALB requires at least two Availability Zones.

If `VPC_ID` is `None`, create a default VPC with `aws ec2 create-default-vpc --region "$AWS_REGION"`.

---

# Part B — Data and messaging services

Elastic Beanstalk manages compute, load balancing, and deployment. It does not manage your state — and although it offers to create an RDS instance *inside* the environment, this runbook deliberately does not use that feature. An environment-owned database is destroyed with the environment, which makes `eb terminate` a data-loss operation and couples your database lifecycle to your application deployment. Create the database separately.

The commands in this Part are the same ones as `aws-deployment-lab-runbook-ecs-express-mode.md` Part B; the detailed rationale for each choice lives there. They are repeated here in full so this runbook can be followed on its own.

## 9. Security groups

The instance security group is created **before** the environment and attached to it in §23. Elastic Beanstalk creates its own group as well, but you cannot authorize database access from a group that does not exist yet, so this runbook supplies one.

```bash
export EB_SG=$(aws ec2 create-security-group \
  --group-name cloudtask-dev-eb-instances-sg \
  --description "CloudTask Elastic Beanstalk instances" \
  --vpc-id "$VPC_ID" --region "$AWS_REGION" \
  --query GroupId --output text)

export RDS_SG=$(aws ec2 create-security-group \
  --group-name cloudtask-dev-eb-rds-sg \
  --description "CloudTask RDS PostgreSQL" \
  --vpc-id "$VPC_ID" --region "$AWS_REGION" \
  --query GroupId --output text)

export REDIS_SG=$(aws ec2 create-security-group \
  --group-name cloudtask-dev-eb-redis-sg \
  --description "CloudTask ElastiCache Redis" \
  --vpc-id "$VPC_ID" --region "$AWS_REGION" \
  --query GroupId --output text)

aws ec2 create-tags --resources "$EB_SG" "$RDS_SG" "$REDIS_SG" \
  --tags $TAGS_EC2 --region "$AWS_REGION"

# PostgreSQL and Redis: from the instance security group only.
aws ec2 authorize-security-group-ingress \
  --group-id "$RDS_SG" --protocol tcp --port 5432 \
  --source-group "$EB_SG" --region "$AWS_REGION"

aws ec2 authorize-security-group-ingress \
  --group-id "$REDIS_SG" --protocol tcp --port 6379 \
  --source-group "$EB_SG" --region "$AWS_REGION"

echo "eb=$EB_SG rds=$RDS_SG redis=$REDIS_SG"
```

Note what is **not** here: no ingress rule on `$EB_SG`. Elastic Beanstalk creates its own instance security group with port 80 open to the load balancer and attaches it alongside this one. This group exists purely as an identity to authorize on the database side.

### Verify

```bash
aws ec2 describe-security-groups --group-ids "$RDS_SG" "$REDIS_SG" "$EB_SG" \
  --query 'SecurityGroups[].{Name:GroupName,Ingress:IpPermissions[].{Port:FromPort,FromSG:UserIdGroupPairs[].GroupId,Cidr:IpRanges[].CidrIp}}' \
  --output json --region "$AWS_REGION"
```

Expected: RDS allows 5432 from `$EB_SG` only, Redis allows 6379 from `$EB_SG` only, and `$EB_SG` has no ingress rules. **No group allows anything from `0.0.0.0/0`.**

---

## 10. RDS PostgreSQL

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name cloudtask-dev-eb-db-subnets \
  --db-subnet-group-description "CloudTask dev DB subnets" \
  --subnet-ids "$SUBNET_A" "$SUBNET_B" \
  --tags $TAGS_EC2 --region "$AWS_REGION"

aws rds create-db-instance \
  --db-instance-identifier cloudtask-dev-postgres \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --allocated-storage 20 \
  --storage-type gp3 \
  --db-name cloudtask \
  --master-username cloudtask_admin \
  --manage-master-user-password \
  --db-subnet-group-name cloudtask-dev-eb-db-subnets \
  --vpc-security-group-ids "$RDS_SG" \
  --no-publicly-accessible \
  --backup-retention-period 1 \
  --no-multi-az \
  --no-deletion-protection \
  --no-auto-minor-version-upgrade \
  --tags $TAGS_EC2 \
  --region "$AWS_REGION"

aws rds wait db-instance-available \
  --db-instance-identifier cloudtask-dev-postgres --region "$AWS_REGION"
```

**Cost reminder:** `db.t4g.micro` with 20 GB gp3 and 1-day backups is the cheapest shape that still behaves like real RDS. Single-AZ and disabled deletion protection are acceptable **only** because this is a disposable lab.

Compose the connection string. The master password is managed by AWS in its own secret, so it is never typed into a shell or a file:

```bash
export DB_HOST=$(aws rds describe-db-instances \
  --db-instance-identifier cloudtask-dev-postgres \
  --query 'DBInstances[0].Endpoint.Address' --output text --region "$AWS_REGION")

export RDS_SECRET_ARN=$(aws rds describe-db-instances \
  --db-instance-identifier cloudtask-dev-postgres \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text --region "$AWS_REGION")

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

Expected: status `available`, `PubliclyAccessible` is `False`, `DBName` is `cloudtask`. **Do not echo `$DATABASE_URL`** — it contains the password.

---

## 11. ElastiCache Redis

Redis serves the **API only**. The worker never connects to it.

```bash
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name cloudtask-dev-eb-redis-subnets \
  --cache-subnet-group-description "CloudTask dev Redis subnets" \
  --subnet-ids "$SUBNET_A" "$SUBNET_B" \
  --region "$AWS_REGION"

aws elasticache create-replication-group \
  --replication-group-id cloudtask-dev-redis \
  --replication-group-description "CloudTask dev Redis" \
  --engine redis \
  --cache-node-type cache.t4g.micro \
  --num-node-groups 1 \
  --replicas-per-node-group 0 \
  --transit-encryption-enabled \
  --cache-subnet-group-name cloudtask-dev-eb-redis-subnets \
  --security-group-ids "$REDIS_SG" \
  --tags $TAGS_EC2 \
  --region "$AWS_REGION"

aws elasticache wait replication-group-available \
  --replication-group-id cloudtask-dev-redis --region "$AWS_REGION"

export REDIS_HOST=$(aws elasticache describe-replication-groups \
  --replication-group-id cloudtask-dev-redis \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
  --output text --region "$AWS_REGION")
echo "redis=$REDIS_HOST"
```

In-transit encryption requires a **replication group**, not a bare cache cluster — that is why this is `create-replication-group` with zero replicas.

### Verify

```bash
aws elasticache describe-replication-groups --replication-group-id cloudtask-dev-redis \
  --query 'ReplicationGroups[0].[Status,TransitEncryptionEnabled,CacheNodeType]' \
  --output table --region "$AWS_REGION"
```

Expected: status `available`, `TransitEncryptionEnabled` is `True`.

**Note:** because in-transit encryption is on, the API **must** set `REDIS_TLS_ENABLED=true`. With that flag unset the client opens a plaintext connection, the server closes it, `/ready` reports `degraded`, and every cache read silently misses while the API otherwise looks healthy.

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

### Verify

```bash
aws sqs get-queue-attributes --queue-url "$EXPORT_QUEUE_URL" \
  --attribute-names RedrivePolicy ReceiveMessageWaitTimeSeconds VisibilityTimeout \
  --output json --region "$AWS_REGION"
```

Expected: the redrive policy names the DLQ ARN with `maxReceiveCount` 3, long polling is 20 seconds, and the visibility timeout is 60 seconds.

---

## 13. S3 export bucket

```bash
export EXPORT_BUCKET_NAME="cloudtask-dev-exports-${AWS_ACCOUNT_ID}-${AWS_REGION}"

aws s3api create-bucket \
  --bucket "$EXPORT_BUCKET_NAME" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"

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
  --tagging "TagSet=[{Key=Project,Value=cloudtask},{Key=Environment,Value=dev},{Key=Owner,Value=jubaer},{Key=ManagedBy,Value=elastic-beanstalk},{Key=Purpose,Value=aws-learning},{Key=CostCenter,Value=personal-learning},{Key=ExpiresOn,Value=$EXPIRES_ON}]"
```

**Note:** in `us-east-1` only, omit `--create-bucket-configuration` entirely — the API rejects it there.

### Verify

```bash
aws s3api get-public-access-block --bucket "$EXPORT_BUCKET_NAME" --output table
aws s3api get-bucket-lifecycle-configuration --bucket "$EXPORT_BUCKET_NAME" --output json
```

Expected: all four public-access flags are `true`, and the lifecycle rule expires the `exports/` prefix after 7 days.

---

## 14. Secrets Manager

One application secret holding only the two genuinely secret values.

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

### Verify

```bash
aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" \
  --query SecretString --output text --region "$AWS_REGION" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sorted(d.keys()), {k: len(v) for k, v in d.items()})'
```

Expected: exactly `['DATABASE_URL', 'JWT_SECRET']`, with `JWT_SECRET` at least 16 characters — the API's configuration schema rejects anything shorter and refuses to boot.

---

# Part C — Images and IAM

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

`IMMUTABLE` tags mean a given Git SHA always identifies exactly one image. **Do not use `latest` for deployments** — a mutable tag makes it impossible to tell which code is running and makes a rollback ambiguous.

Images are built and pushed in §21, after the environment hostname is reserved.

### Verify

```bash
aws ecr describe-repositories \
  --query 'repositories[?starts_with(repositoryName,`cloudtask-dev-`)].[repositoryName,imageTagMutability]' \
  --output table --region "$AWS_REGION"
```

Expected: three repositories, all `IMMUTABLE`.

---

## 16. IAM roles and the instance profile

Elastic Beanstalk needs two IAM identities, and since 2024 it does not create them for you.

- The **service role** lets Elastic Beanstalk call other AWS services on your behalf to manage the environment and gather health data.
- The **instance profile** is what the EC2 instances themselves use. This is the one that matters most here: it is how the instances authenticate to ECR, read secrets, and reach SQS and S3.

### Step 16.1 — the service role

```bash
aws iam create-role --role-name aws-elasticbeanstalk-service-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "elasticbeanstalk.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' --tags $TAGS_EC2

aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth
aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy
```

**Note:** if the role already exists in this account, `create-role` fails with `EntityAlreadyExists`. That is harmless — skip to `attach-role-policy`, which is idempotent.

### Step 16.2 — the instance profile role

```bash
aws iam create-role --role-name aws-elasticbeanstalk-ec2-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' --tags $TAGS_EC2

# Platform basics: read app versions from S3, report health, write metrics.
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier

# Pull images from ECR. This is what makes ECR authentication automatic.
aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

**ECR authentication needs nothing else.** AWS documents this explicitly: *"When you store your Docker images in Amazon ECR, Elastic Beanstalk automatically authenticates to the Amazon ECR registry with your environment's instance profile."* There is no `.dockercfg` to upload to S3 and no `docker login` prebuild hook. If you have seen either of those in a blog post, it was for a non-ECR private registry or a retired platform.

### Step 16.3 — the application's own permissions

Unlike the ECS runbooks, there is no per-service task role here: **all four containers share the instance profile.** That is a genuine loss of isolation — the web container can technically call SQS, and the api container can technically write to S3, because they run under the same credentials. The specification's §15 split between an API task role and a worker task role cannot be expressed on this platform without running separate environments.

Grant the union of what api and worker need, scoped as tightly as the resources allow:

```bash
aws iam put-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-name cloudtask-dev-application-permissions \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadApplicationSecret",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": ["${APP_SECRET_ARN}"]
    },
    {
      "Sid": "ExportQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": ["${QUEUE_ARN}"]
    },
    {
      "Sid": "ExportObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::${EXPORT_BUCKET_NAME}/exports/*"]
    }
  ]
}
JSON
)"
```

Note the trade honestly in your lab journal: this is one role where the specification asks for two, and the reason is the platform's placement model, not carelessness.

### Step 16.4 — create the instance profile

An EC2 instance is given a role through an **instance profile**, which is a separate object that wraps the role. This step is easy to forget and produces a confusing `Not authorized to perform: iam:PassRole` or an instance that cannot pull images.

```bash
aws iam create-instance-profile \
  --instance-profile-name aws-elasticbeanstalk-ec2-role \
  --tags $TAGS_EC2

aws iam add-role-to-instance-profile \
  --instance-profile-name aws-elasticbeanstalk-ec2-role \
  --role-name aws-elasticbeanstalk-ec2-role
```

### Verify

```bash
aws iam get-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role \
  --query 'InstanceProfile.Roles[].RoleName' --output text

for r in aws-elasticbeanstalk-service-role aws-elasticbeanstalk-ec2-role; do
  echo "== $r"
  aws iam list-attached-role-policies --role-name "$r" \
    --query 'AttachedPolicies[].PolicyName' --output text
  aws iam list-role-policies --role-name "$r" --query 'PolicyNames' --output text
done
```

Expected: the instance profile contains `aws-elasticbeanstalk-ec2-role`; the service role has the enhanced-health and managed-updates policies; the instance role has `AWSElasticBeanstalkWebTier`, `AmazonEC2ContainerRegistryReadOnly`, and one inline policy. **No role has `AdministratorAccess` and no policy uses a wildcard resource.**

**Note:** IAM is eventually consistent. If `eb create` in §23 fails with an assume-role or instance-profile error immediately after this step, wait about a minute and retry the identical command.

---

# Part D — The deployment bundle

## 17. What goes in the bundle

The bundle is what you hand to Elastic Beanstalk. It lives in `deploy/beanstalk/` and is already committed to this repository:

```text
deploy/beanstalk/
├── docker-compose.yml                     # the four services
├── proxy/
│   ├── Dockerfile                         # nginx, built on the instance
│   ├── nginx.conf                         # path routing + healthd logging
│   └── proxy_headers.conf                 # shared proxy headers
├── .platform/hooks/postdeploy/
│   └── 01_setup_healthd_permissions.sh    # lets nginx write healthd logs
└── .gitignore                             # keeps .env out of the bundle
```

Nothing here contains an account ID, an endpoint, or a secret. Every environment-specific value arrives as an environment property, set in §23 — so the bundle is portable and safe to commit.

**Note:** the EB CLI deploys from **git** when the project directory is inside a git repository. It bundles committed content, not your working tree. If you edit any file in `deploy/beanstalk/`, either commit it or deploy with `eb deploy --staged` after `git add`. Editing a file and running a plain `eb deploy` silently deploys the previous version, which is a genuinely confusing way to lose an hour.

### Verify the bundle locally before deploying

Neither check needs AWS, and both catch mistakes that are painful to diagnose on an instance:

```bash
# 1. The compose file renders with all variables resolved.
ECR_REGISTRY=123.dkr.ecr.example.amazonaws.com GIT_SHA=test \
DATABASE_URL=postgres://u:p@h:5432/d JWT_SECRET=0123456789abcdef \
REDIS_HOST=r.example.com EXPORT_QUEUE_URL=https://sqs.example.com/1/q \
EXPORT_BUCKET_NAME=b AWS_REGION="$AWS_REGION" PUBLIC_ORIGIN=http://example.com \
  docker compose -f deploy/beanstalk/docker-compose.yml config >/dev/null \
  && echo "compose: OK"

# 2. The nginx configuration is valid.
docker build -q -t cloudtask-proxy-check deploy/beanstalk/proxy \
  && docker run --rm cloudtask-proxy-check nginx -t

# 3. The platform hook is valid shell and executable.
bash -n deploy/beanstalk/.platform/hooks/postdeploy/01_setup_healthd_permissions.sh \
  && echo "hook: OK"
test -x deploy/beanstalk/.platform/hooks/postdeploy/01_setup_healthd_permissions.sh \
  && echo "hook: executable"
```

Expected: `compose: OK`, `syntax is ok` / `test is successful` from nginx, and both hook checks passing.

**Note:** the hook must have the executable bit set in git, or Elastic Beanstalk will not run it. Confirm with `git ls-files -s deploy/beanstalk/.platform/hooks/postdeploy/01_setup_healthd_permissions.sh` — the mode must be `100755`, not `100644`. Fix with `git update-index --chmod=+x <path>`.

---

## 18. How configuration reaches the containers

This is the mechanism that makes or breaks the deployment, and it is worth understanding before you deploy rather than after.

1. You set **environment properties** on the environment (§23), either as plain values or as references to Secrets Manager.
2. On each instance, during bootstrap, Elastic Beanstalk writes those properties into a **`.env` file in the application directory**.
3. Docker Compose reads `.env` automatically and uses it to interpolate `${VAR}` in `docker-compose.yml`.
4. `docker-compose.yml` maps those values into each container's `environment:` block explicitly.

Three consequences follow, and all three have bitten people:

**Do not put a `.env` file in the bundle.** If Elastic Beanstalk finds one, it will not generate its own — and every `${VAR}` resolves to an empty string. The application then fails configuration validation and exits, which looks like an application bug rather than a packaging mistake. `deploy/beanstalk/.gitignore` excludes `.env` for exactly this reason.

**Interpolation is not injection.** A value in `.env` is available for `${VAR}` substitution in the compose file, but it is *not* automatically passed into containers. That is why `docker-compose.yml` lists every variable explicitly in each service's `environment:` block. The upside is that the compose file documents each container's configuration contract the way an ECS task definition does — and it is why `worker` has no `REDIS_HOST` and `web` has no `DATABASE_URL`.

**Secrets are fetched once, at instance bootstrap.** Elastic Beanstalk resolves the `environmentsecrets` namespace when an instance starts, not continuously. Rotating a secret in Secrets Manager does **not** update a running environment; you must redeploy or replace instances. §29 demonstrates this.

**Note:** the `aws:elasticbeanstalk:application:environmentsecrets` namespace requires a platform version released on or after 13 January 2026. §6.6 selects the newest AL2023 Docker stack, which satisfies this. If your Region only offers an older stack, use §23.3's fallback.

---

## 19. What the reverse proxy does

`deploy/beanstalk/proxy/nginx.conf` is the piece with no equivalent in the other three runbooks, because in those the load balancer does this job.

**Path routing.** It reproduces the ALB listener rules from `aws-deployment-lab-runbook-manual.md`:

| Path | Upstream | Why |
|---|---|---|
| `/api/` | `api:3000` | the global API prefix is `api/v1` |
| `/health` | `api:3000` | exact match — excluded from the `api/v1` prefix |
| `/ready` | `api:3000` | exact match — excluded from the `api/v1` prefix |
| `/docs` | `api:3000` | Swagger UI |
| everything else | `web:3000` | the Next.js application |

`/health` and `/ready` are matched as exact locations rather than prefixes because `apps/api/src/main.ts` calls `setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] })`. They sit at the root, not under `/api/v1`. Getting this wrong is the most common health-check mistake across all four runbooks.

**Deferred DNS resolution.** Upstreams are assigned to variables before `proxy_pass`:

```text
resolver 127.0.0.11 valid=10s ipv6=off;
set $api_upstream http://api:3000;
proxy_pass $api_upstream;
```

nginx normally resolves upstream hostnames once, at startup, and refuses to start if a name does not resolve. Since all four containers start together, `api` may not be resolvable when nginx boots. Using a variable defers resolution to request time against Docker's embedded DNS server at `127.0.0.11`, so the proxy starts regardless of ordering and recovers on its own when a container restarts.

**Client IP preservation.** `proxy_headers.conf` sets `X-Forwarded-For`. The API sets `trust proxy = 1` and derives the client IP from that header for IP-based rate limiting. Without it, every request appears to come from the proxy container, and the login limit of 10 attempts per 5 minutes per IP would apply to *all users at once* — a self-inflicted denial of service that only appears under concurrent use.

**Enhanced health logging.** The `healthd` log format and the hourly-rotated log path are what Elastic Beanstalk's health agent reads to produce request-rate, latency-percentile, and status-code metrics. Without them the environment still reports `Ok`, but on instance health only — it can tell you the instance is alive while every request returns 500. §34 covers the difference.

**One origin.** Because api and web are served from the same hostname, there is no cross-origin request and therefore no CORS configuration step in this runbook. Compare `aws-deployment-lab-runbook-ecs-express-mode.md` §25.3, which has to close an api → web → api dependency cycle precisely because Express Mode gives each service its own hostname.

---

# Part E — Deploy

## 20. Reserve the hostname

`NEXT_PUBLIC_API_BASE_URL` is inlined into the JavaScript bundle at image build time. So the public hostname must be known **before** the web image is built.

Elastic Beanstalk lets you claim a CNAME prefix, which makes the URL deterministic and turns what would be a two-pass build into a single pass. Check availability first:

```bash
aws elasticbeanstalk check-dns-availability \
  --cname-prefix "$EB_CNAME" --region "$AWS_REGION" \
  --query '[Available,FullyQualifiedCNAME]' --output table
```

Expected: `Available` is `True`. CNAME prefixes are unique per Region across **all AWS accounts**, so if it is taken, pick another and update `EB_CNAME`:

```bash
export EB_CNAME="cloudtask-dev-$(openssl rand -hex 3)"
aws elasticbeanstalk check-dns-availability --cname-prefix "$EB_CNAME" \
  --region "$AWS_REGION" --query '[Available,FullyQualifiedCNAME]' --output table
```

Record the resulting origin:

```bash
export PUBLIC_ORIGIN="http://${EB_CNAME}.${AWS_REGION}.elasticbeanstalk.com"
echo "public origin: $PUBLIC_ORIGIN"
```

**Note:** claiming a prefix with `check-dns-availability` does not reserve it — it only reports current availability. Another account could take it between this check and `eb create`. If creation fails on the CNAME, repeat this section with a new prefix and rebuild the web image, because the baked-in URL will have changed.

---

## 21. Build and push the images

### Step 21.1 — authenticate Docker to ECR

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"
```

### Step 21.2 — build all three images

All three Dockerfiles take the **repository root** as build context, and the production stage is named `prod`.

```bash
docker build --platform linux/amd64 \
  -f apps/api/Dockerfile --target prod \
  -t "$ECR_REGISTRY/cloudtask-dev-api:$GIT_SHA" .

docker build --platform linux/amd64 \
  -f apps/worker/Dockerfile --target prod \
  -t "$ECR_REGISTRY/cloudtask-dev-worker:$GIT_SHA" .

docker build --platform linux/amd64 \
  -f apps/web/Dockerfile --target prod \
  --build-arg NEXT_PUBLIC_API_BASE_URL="/api/v1" \
  -t "$ECR_REGISTRY/cloudtask-dev-web:$GIT_SHA" .

docker push "$ECR_REGISTRY/cloudtask-dev-api:$GIT_SHA"
docker push "$ECR_REGISTRY/cloudtask-dev-worker:$GIT_SHA"
docker push "$ECR_REGISTRY/cloudtask-dev-web:$GIT_SHA"
```

**The web build argument is the relative path `/api/v1`, not an absolute URL.** The reverse proxy serves api and web from one origin, so the browser can call `/api/v1/...` on the page's own host. This is strictly better than an absolute URL: the image becomes independent of the hostname, so a CNAME change no longer forces a rebuild.

If you prefer to see the absolute-URL behavior — for direct comparison with the Express Mode runbook, where it is unavoidable — use `--build-arg NEXT_PUBLIC_API_BASE_URL="$PUBLIC_ORIGIN/api/v1"` instead. Everything still works; the image simply becomes tied to that hostname.

**Note:** `--platform linux/amd64` is required when building on Apple Silicon or any other arm64 machine. The `t3.small` instances in this environment are X86_64; an arm64 image fails at startup with `exec format error`, which surfaces as a container that will not stay up rather than as an architecture error.

**Note:** `.github/workflows/release.yml` already builds and pushes all three images via GitHub OIDC, tagged with the full commit SHA. Set the repository variables `AWS_ROLE_ARN`, `AWS_REGION`, and `NEXT_PUBLIC_API_BASE_URL` (to `/api/v1`) to use CI instead of this section. Note that the workflow tags images with the **full** 40-character SHA while this runbook uses the short SHA, so set `GIT_SHA=$(git rev-parse HEAD)` if you deploy CI-built images.

### Verify

```bash
for app in api worker web; do
  aws ecr describe-images --repository-name "cloudtask-dev-${app}" \
    --image-ids imageTag="$GIT_SHA" \
    --query 'imageDetails[0].[imageTags[0],imageSizeInBytes]' \
    --output text --region "$AWS_REGION"
done
```

Expected: three images tagged with the current SHA.

Confirm the base URL really was baked into the web image, before deploying one that silently points at `localhost`:

```bash
docker run --rm --entrypoint sh "$ECR_REGISTRY/cloudtask-dev-web:$GIT_SHA" \
  -c "grep -rlo --include='*.js' 'localhost:3001' /app/apps/web/.next/static | head -n3" \
  && echo "WARNING: localhost fallback found in the bundle" \
  || echo "no localhost fallback — build arg was applied"
```

Expected: `no localhost fallback`. If the warning appears, `--build-arg` did not reach `next build` — check that you passed it and re-run the build.

---

## 22. Initialize the EB CLI

Run every `eb` command from the bundle directory.

```bash
cd deploy/beanstalk

eb init "$EB_APP" \
  --platform "$EB_PLATFORM" \
  --region "$AWS_REGION"
```

This creates the Elastic Beanstalk **application** — a container for environments and versions — and writes `.elasticbeanstalk/config.yml` locally.

Configure SSH now, because §24 needs it to run the database migration:

```bash
eb init -i
```

Answer the prompts, choosing the same application and platform, and answer **yes** to setting up SSH. Select an existing key pair or let it create one.

### Verify

```bash
cat .elasticbeanstalk/config.yml
aws elasticbeanstalk describe-applications --application-names "$EB_APP" \
  --region "$AWS_REGION" --query 'Applications[0].[ApplicationName,DateCreated]' \
  --output table
```

Expected: the config names your application, the AL2023 Docker platform, and your Region, and the application exists in AWS.

---

## 23. Create the environment

### Step 23.1 — create it

This is the longest single step in the runbook — roughly 5 to 10 minutes — because it provisions a CloudFormation stack, a load balancer, an Auto Scaling group, and an instance.

```bash
eb create "$EB_ENV" \
  --cname "$EB_CNAME" \
  --platform "$EB_PLATFORM" \
  --instance-types t3.small \
  --elb-type application \
  --min-instances 1 \
  --max-instances 2 \
  --service-role aws-elasticbeanstalk-service-role \
  --instance_profile aws-elasticbeanstalk-ec2-role \
  --vpc.id "$VPC_ID" \
  --vpc.ec2subnets "$SUBNETS" \
  --vpc.elbsubnets "$SUBNETS" \
  --vpc.publicip \
  --vpc.elbpublic \
  --vpc.securitygroups "$EB_SG" \
  --envvars "ECR_REGISTRY=$ECR_REGISTRY,GIT_SHA=$GIT_SHA,AWS_REGION=$AWS_REGION,REDIS_HOST=$REDIS_HOST,EXPORT_QUEUE_URL=$EXPORT_QUEUE_URL,EXPORT_BUCKET_NAME=$EXPORT_BUCKET_NAME,PUBLIC_ORIGIN=$PUBLIC_ORIGIN" \
  --tags "$TAGS_EB" \
  --region "$AWS_REGION"
```

**Note:** EB CLI option names have shifted across versions — in particular `--instance_profile` uses an underscore while most others use hyphens, and older versions use `--instance_type` (singular) instead of `--instance-types`. Run `eb create --help` and confirm the flag names your installed version accepts before running this. If a flag is rejected, drop it here and apply the equivalent option setting with `aws elasticbeanstalk update-environment --option-settings` in §23.3.

**Cost reminder:** `--max-instances 2` caps the Auto Scaling group. Every instance runs all four containers and costs a full `t3.small` whether busy or idle. Raising this multiplies your bill directly.

**Note:** the environment will report an unhealthy status during and shortly after creation. The containers cannot start until the secrets in §23.2 are configured, and `web` cannot start until `api` is reachable. Do not begin troubleshooting until §23.3 is done.

### Step 23.2 — supply the secrets

The two secret values are referenced from Secrets Manager rather than passed as plain environment properties, so their values never appear in the environment configuration, in `eb config` output, or in your shell history.

```bash
aws elasticbeanstalk update-environment \
  --environment-name "$EB_ENV" \
  --region "$AWS_REGION" \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environmentsecrets,OptionName=DATABASE_URL,Value=${APP_SECRET_ARN}:DATABASE_URL" \
    "Namespace=aws:elasticbeanstalk:application:environmentsecrets,OptionName=JWT_SECRET,Value=${APP_SECRET_ARN}:JWT_SECRET" \
  --query '[EnvironmentName,Status]' --output table
```

The `:KEY` suffix on the ARN extracts a single field from the JSON secret. Unlike the ECS `valueFrom` syntax, there are **no** trailing colons here.

Wait for the update to finish:

```bash
aws elasticbeanstalk wait environment-updated \
  --environment-names "$EB_ENV" --region "$AWS_REGION"
```

**Fallback if the `environmentsecrets` namespace is unavailable.** If your platform version predates January 2026 and rejects that namespace, pass the values as ordinary environment properties instead:

```bash
# Less good: the values are visible in `eb printenv` and in the environment
# configuration. Acceptable for a disposable lab only.
eb setenv DATABASE_URL="$DATABASE_URL" JWT_SECRET="$JWT_SECRET"
```

Record which path you took in your lab journal. The difference matters: with the secrets namespace, the secret is the source of truth and the environment holds only a pointer.

### Step 23.3 — confirm health and configuration

```bash
eb status
eb health --refresh
```

Press `q` to leave the health view.

Expected: environment health `Ok` (green), one instance in service, and the four containers running.

Confirm the environment properties resolved, without printing the secret values:

```bash
eb printenv
```

Expected: `ECR_REGISTRY`, `GIT_SHA`, `AWS_REGION`, `REDIS_HOST`, `EXPORT_QUEUE_URL`, `EXPORT_BUCKET_NAME`, and `PUBLIC_ORIGIN` all present and non-empty. Secret-backed properties appear as references rather than values.

### Verify the containers on the instance

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose ps"
```

Expected: four containers — `nginx-proxy`, `api`, `worker`, `web` — all `Up`.

Confirm the generated `.env` exists and has content, since this is the mechanism §18 depends on:

```bash
eb ssh "$EB_ENV" --command "sudo test -f /var/app/current/.env && sudo wc -l /var/app/current/.env && sudo cut -d= -f1 /var/app/current/.env | sort"
```

Expected: the file exists and lists your property names — including `DATABASE_URL` and `JWT_SECRET`, which confirms the secrets were fetched at bootstrap and turned into environment properties. **This command prints variable names only, never values.**

**If `.env` is missing or empty**, a `.env` file was included in the deployed bundle, which suppresses generation. Confirm with `git ls-files deploy/beanstalk | grep -c '\.env$'` — the answer must be `0`.

---

## 24. Run the database migration

Migrations do not run on application boot: both the API and the worker set `synchronize: false` and `migrationsRun: false`, deliberately. Schema changes are an explicit, single-writer operation.

The production image cannot run the development migration command. `pnpm --filter @cloudtask/api migration:run` relies on `pnpm` and `ts-node`, both removed by `pnpm deploy --prod` when the `prod` stage is built. The command that works invokes the TypeORM CLI directly against the compiled data source.

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose run --rm --no-deps api node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run"
```

`--no-deps` prevents Compose from starting a second copy of the other services, and `--rm` removes the one-off container when it exits.

**Note:** `aws-deployment-lab-runbook-manual.md` §38 instructs you to override the container command with `pnpm --filter api migration:run`. That is wrong twice over — the package is `@cloudtask/api`, not `api`, and neither `pnpm` nor `ts-node` exists in the production image.

### Verify

```bash
export TOKEN_CHECK=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$PUBLIC_ORIGIN/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"schema-probe@example.com","password":"ProbePassword123","displayName":"Probe"}')
echo "register status: $TOKEN_CHECK"
```

Expected: `201`. A `500` means the schema is missing and the migration did not actually apply — re-read the command output above.

**This is a lab shortcut, and you should know why.** Running migrations over SSH from your laptop is not a deployment practice:

- It depends on SSH access being open and on you being present.
- It runs on one arbitrary instance, with nothing preventing a second person running it concurrently.
- It is not recorded anywhere as part of the deployment.

The production alternatives, in rough order of preference: a migration step in the deployment pipeline that runs once before the new version is released (`.github/workflows/release.yml` on the `infrastructure` branch does exactly this with a one-off ECS task); a CodeBuild project triggered before deployment; or a dedicated one-off runner outside the environment. What you must **not** do is put the migration in a `.platform/hooks/predeploy` script — that runs on every instance, so a two-instance environment races two migration runners against the same schema.

---

# Part F — Verification

## 25. End-to-end functional verification

A deployment is not finished because the environment is green. It is finished when a request travels the whole path: browser → proxy → API → Postgres → SQS → worker → S3 → presigned download.

Everything below goes through `$PUBLIC_ORIGIN`, so it also proves the proxy's path routing works.

### Step 25.1 — health endpoints through the proxy

```bash
curl -fsS "$PUBLIC_ORIGIN/health" && echo
curl -fsS "$PUBLIC_ORIGIN/ready"  && echo
curl -fsS -o /dev/null -w 'docs:%{http_code}\n' "$PUBLIC_ORIGIN/docs"
curl -fsS -o /dev/null -w 'web:%{http_code}\n'  "$PUBLIC_ORIGIN/"
```

Expected: `/health` returns `{"status":"ok"}`; `/ready` reports `ok` with both `database` and `redis` healthy; `/docs` and `/` both return `200`.

This single block validates the whole routing table. If `/health` returns the Next.js 404 page, the proxy is sending it to `web` instead of `api` — check the exact-match location blocks in `nginx.conf`. If `/ready` reports `degraded`, check `REDIS_TLS_ENABLED` and the Redis security group.

### Step 25.2 — register and log in

```bash
export TEST_EMAIL="lab-$(date -u +%s)@example.com"
export TEST_PASSWORD='LabPassword123!'
export API_BASE_URL="$PUBLIC_ORIGIN/api/v1"

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

Expected: registration returns `201` with `id`, `email`, and `displayName` and **no password hash**; the token is a non-empty JWT.

### Step 25.3 — create a project and a task

```bash
export PROJECT_ID=$(curl -fsS -X POST "$API_BASE_URL/projects" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Beanstalk Lab","description":"Deployed via Elastic Beanstalk"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Verify the export pipeline","status":"todo","priority":"high"}' \
  | python3 -m json.tool

curl -fsS "$API_BASE_URL/projects/$PROJECT_ID/summary" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: both are created and the summary returns counts. The summary is the Redis-cached endpoint; call it twice and the second call should be measurably faster.

### Step 25.4 — request an export and watch the worker process it

```bash
export EXPORT_ID=$(curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["exportId"])')

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

### Step 25.5 — download the export and confirm the object

```bash
export DOWNLOAD_URL=$(curl -fsS "$API_BASE_URL/exports/$EXPORT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["downloadUrl"])')

curl -fsS "$DOWNLOAD_URL" | head -n 5
aws s3 ls "s3://$EXPORT_BUCKET_NAME/exports/" --recursive --region "$AWS_REGION"
```

Expected: a CSV with a header row and the task you created, and one object at `exports/{userId}/{exportId}.csv`. The presigned URL is valid for 5 minutes.

### Step 25.6 — use the web application in a browser

Open `$PUBLIC_ORIGIN`, register a user through the UI, create a project, and request an export.

**Open the browser developer console.** With the relative base URL from §21.2, network calls should go to `/api/v1/...` on the same origin, with no CORS preflight at all. If you instead see calls to `http://localhost:3001`, the web image was built without the build argument — re-run §21.2.

### Step 25.7 — confirm the queue drained and health is green

```bash
aws sqs get-queue-attributes --queue-url "$EXPORT_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --output table --region "$AWS_REGION"

aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --output table --region "$AWS_REGION"

eb health
```

Expected: both main-queue counts are `0`, the DLQ is empty, and enhanced health shows request metrics with a healthy status-code distribution. **A non-empty DLQ means an export failed silently** — read the worker logs before continuing.

### Step 25.8 — confirm enhanced health is reading the proxy logs

```bash
eb health --refresh
```

Expected: the display shows a **request count and latency percentiles** (`p99`, `p90`, `p50`), not just instance status. Press `q` to exit.

**If request metrics are absent** while the application clearly works, the `healthd` logs are not being written — the postdeploy hook did not run or could not chown the directory. Check it:

```bash
eb ssh "$EB_ENV" --command "sudo ls -la /var/log/nginx/healthd/ && sudo tail -n 3 /var/log/nginx/healthd/application.log.* 2>/dev/null"
```

Expected: the directory exists and contains an hourly log file with `healthd`-format lines. If it is empty or missing, confirm the hook is executable in git (§17) and redeploy.

---

# Part G — Controlled failure drills

Each drill follows the same four-part shape: introduce the failure, observe the symptom, troubleshoot from the symptom, restore. The diagnostic path is the point, not the restore step.

Record each drill in the journal format in §37.

## 26. Drill 1 — stop the worker container

The most common production failure shape: the synchronous path is perfectly healthy and the asynchronous one is dead.

### Introduce failure

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose stop worker"
```

### Observe

```bash
export STUCK_EXPORT=$(curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["exportId"])')

curl -fsS "$API_BASE_URL/exports/$STUCK_EXPORT" -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool

eb health
```

- **`eb health` still reports `Ok`.** This is the important observation: Elastic Beanstalk's health model watches the HTTP request path and the instance. The worker serves no requests, so its absence is completely invisible to the platform.
- `/health` and `/ready` both return `200`.
- The export request still returns `202 Accepted`. Nothing reports an error.
- The status stays `queued` forever.
- Queue depth grows and message age climbs:

```bash
aws sqs get-queue-attributes --queue-url "$EXPORT_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateAgeOfOldestMessage \
  --output table --region "$AWS_REGION"
```

### Troubleshoot

Check in this order:

1. Is the export row stuck at `queued`? Then the API enqueued successfully and the consumer is the problem.
2. Depth greater than zero with a climbing oldest-message age confirms messages arrive and nothing consumes them.
3. Check the containers, not the environment: `eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose ps"`. `worker` shows as `exited`.
4. If `worker` were `Up` but not consuming, you would read its log instead: `eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose logs --tail 50 worker"`.

The lesson: **`eb health` green does not mean the application works.** Elastic Beanstalk's health model covers a request-serving web tier. Everything else needs alarms you build yourself — §34.

### Restore

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose start worker"
sleep 20
curl -fsS "$API_BASE_URL/exports/$STUCK_EXPORT" -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Expected: the backlog drains and the previously stuck export reaches `completed` without being re-requested. Nothing was lost — the queue held the work. That is the durability you paid SQS for.

---

## 27. Drill 2 — deploy a broken version

This is the most important drill in this runbook. It shows a real, documented difference in deployment safety between Elastic Beanstalk and ECS Express Mode.

AWS states it plainly: *"Elastic Beanstalk does not roll back multi-container environments due to a failed Amazon ECS task. If a container fails to start in your environment, redeploy the current version or a previous working version."* The same guidance applies to a failed container start on the Docker Compose platform. **There is no canary, no traffic shifting, and no automatic rollback.**

### Introduce failure

Deploy a version that references an image tag which does not exist:

```bash
eb setenv GIT_SHA=does-not-exist-0000
```

### Observe

```bash
eb status
eb health --refresh
curl -sS -o /dev/null -w 'status:%{http_code}\n' "$PUBLIC_ORIGIN/health"
```

- Environment health goes **`Severe`** or **`Degraded`** and stays there.
- The site returns `502` or `503`, or times out. **This is a real outage** — contrast with `aws-deployment-lab-runbook-ecs-express-mode.md` §36, where the equivalent failure never affects a single user request.
- Nothing recovers on its own. Waiting does not help.

Read the cause:

```bash
eb logs --all | grep -i -m10 'pull\|manifest\|not found\|error'
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose ps"
```

Expected: an image-pull failure naming the missing manifest, and containers that are not running.

### Troubleshoot

Check in this order:

1. `eb status` gives environment health; `eb events` gives the ordered history of what the platform tried and how it failed. Read `eb events` first — it usually names the cause directly.
2. `eb logs --all` retrieves the deployment logs from the instance, including `eb-engine.log`, which records the `docker compose` invocation and its output.
3. An image-pull failure means the tag, the registry, or the instance profile's ECR permission is wrong. Confirm the tag exists: `aws ecr describe-images --repository-name cloudtask-dev-api --image-ids imageTag="$GIT_SHA"`.
4. Distinguish this from a container that pulls but exits — that is a configuration failure, and the log would come from the application rather than the platform.

### Restore

There is no automatic rollback, so you recover manually. Either correct the variable:

```bash
export GIT_SHA=$(git rev-parse --short HEAD)
eb setenv GIT_SHA="$GIT_SHA"
```

Or redeploy a previous application version, which is the documented recovery path:

```bash
eb appversion --region "$AWS_REGION"
```

That opens an interactive list of application versions. To do it non-interactively:

```bash
aws elasticbeanstalk describe-application-versions \
  --application-name "$EB_APP" --region "$AWS_REGION" \
  --query 'ApplicationVersions[].[VersionLabel,DateCreated]' --output table

eb deploy "$EB_ENV" --version "<a known-good version label>"
```

### Verify

```bash
aws elasticbeanstalk wait environment-updated \
  --environment-names "$EB_ENV" --region "$AWS_REGION"
eb status
curl -fsS "$PUBLIC_ORIGIN/health" && echo
```

Expected: health returns to `Ok` and `/health` returns `200`.

**Write down the time to recover.** Then compare it with §36 of the Express Mode runbook, where the equivalent recovery time is zero because no user traffic ever reached the broken version. That difference is the concrete cost of this platform's deployment model.

**Note:** Elastic Beanstalk can be configured with immutable or rolling-with-additional-batch deployment policies, which reduce this exposure by validating new instances before shifting traffic. They are not the default and they cost more (immutable doubles instance count during a deploy). Setting `aws:elasticbeanstalk:command/DeploymentPolicy` to `Immutable` is a worthwhile follow-up experiment.

---

## 28. Drill 3 — remove Redis and prove graceful degradation

### Introduce failure

Break the network path rather than deleting the cluster:

```bash
aws ec2 revoke-security-group-ingress \
  --group-id "$REDIS_SG" --protocol tcp --port 6379 \
  --source-group "$EB_SG" --region "$AWS_REGION"
```

### Observe

```bash
curl -fsS "$PUBLIC_ORIGIN/ready" | python3 -m json.tool
curl -fsS "$API_BASE_URL/projects/$PROJECT_ID/summary" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
eb health
```

- `/ready` returns **HTTP 200** with status `degraded` — not 503. Redis is explicitly non-critical.
- `/health` is unaffected.
- The summary endpoint still returns **correct data**, just without caching.
- Rate limiting falls back to a per-process in-memory limiter, so limits become per-container rather than global.
- **`eb health` stays `Ok`**, because the load balancer health check targets `/` and the application is serving.

### Troubleshoot

Check in this order:

1. `/ready` distinguishes the two dependencies, so a `degraded` response names Redis without guessing.
2. Worker logs are silent — correct, because the worker never uses Redis. Redis errors in the worker log would mean something is misconfigured beyond this drill.
3. Verify the cluster before blaming the client: `aws elasticache describe-replication-groups --replication-group-id cloudtask-dev-redis --query 'ReplicationGroups[0].Status'`. If it is `available`, the failure is the security group or TLS.
4. If Redis is reachable but the API still degrades, check `REDIS_TLS_ENABLED`. With in-transit encryption on and that flag off, the symptom is identical to a blocked port.

### Restore

```bash
aws ec2 authorize-security-group-ingress \
  --group-id "$REDIS_SG" --protocol tcp --port 6379 \
  --source-group "$EB_SG" --region "$AWS_REGION"
sleep 30
curl -fsS "$PUBLIC_ORIGIN/ready" | python3 -m json.tool
```

Expected: status returns to `ok` with no container restart. The API reconnects on its own — it treats Redis as optional by design.

---

## 29. Drill 4 — rotate a secret without redeploying

Demonstrates the bootstrap-time-only behavior described in §18, which is a genuine operational trap on this platform.

### Introduce failure

Change the secret in Secrets Manager to a deliberately wrong value, and **do not** redeploy:

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
```

### Observe

```bash
curl -fsS "$PUBLIC_ORIGIN/ready" | python3 -m json.tool
curl -fsS "$API_BASE_URL/projects" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

- **Nothing changes. The application keeps working perfectly.** The running containers still hold the value fetched when the instance booted.
- `/ready` still reports `ok`, and the database is still reachable.

This cuts both ways, and both directions are worth internalizing:

- A **bad** secret change does not take down a running environment — you get a grace period.
- A **good** secret change, such as a rotated database password, does not take effect either. If RDS rotates the master password and the environment is not redeployed, the containers keep using the old credential until the next instance replacement — at which point the application fails for a reason that has nothing to do with the deployment that triggered it.

### Now force instance replacement to see the failure land

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose restart api"
sleep 30
curl -sS -o /dev/null -w 'ready:%{http_code}\n' "$PUBLIC_ORIGIN/ready"
```

Expected: still `200`. Restarting the container is **not** enough — the value lives in the instance's `.env`, written at bootstrap. Confirm it directly:

```bash
eb ssh "$EB_ENV" --command "sudo grep -o 'no-such-host' /var/app/current/.env || echo 'old value still in .env'"
```

Expected: `old value still in .env`. Only a deployment or instance replacement rewrites that file.

### Troubleshoot

Check in this order:

1. Compare what Secrets Manager holds against what the instance holds. They can differ, and that gap is the whole lesson.
2. `sudo cut -d= -f1 /var/app/current/.env` shows which properties exist on the instance; the secret's current version shows what *should* be there.
3. If an application fails after an unrelated deployment, suspect a secret that was rotated at some earlier point and only took effect now.

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

# Force a bootstrap so the environment re-reads the secret.
eb deploy "$EB_ENV"
aws elasticbeanstalk wait environment-updated \
  --environment-names "$EB_ENV" --region "$AWS_REGION"
curl -fsS "$PUBLIC_ORIGIN/ready" | python3 -m json.tool
```

**Note:** `$DATABASE_URL` must still be set in your shell. If you have opened a new terminal since §10, re-derive it there before running this.

---

## 30. Drill 5 — fill the dead-letter queue

### Introduce failure

Remove the instance profile's S3 write permission, so exports fail *after* the message has been received. With `maxReceiveCount` 3, each message is retried three times and then moved to the DLQ.

```bash
aws iam delete-role-policy \
  --role-name aws-elasticbeanstalk-ec2-role \
  --policy-name cloudtask-dev-application-permissions

eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose restart worker"

for i in 1 2 3; do
  curl -fsS -X POST "$API_BASE_URL/projects/$PROJECT_ID/exports" \
    -H "Authorization: Bearer $TOKEN" >/dev/null
done
```

**Note:** removing this policy also revokes SQS and Secrets Manager access, because all four containers share the single instance profile — the isolation trade-off from §16.3, now visible as a blast radius. In the ECS runbooks the same drill affects only the worker.

### Observe

- Export requests may now fail at enqueue time too, not only at processing time — a wider failure than the ECS equivalent.
- Worker logs show repeated `AccessDenied`, three attempts per message:

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose logs --tail 60 worker" | grep -i -m10 'accessdenied\|error'
```

- After roughly three visibility timeouts, messages land in the DLQ:

```bash
aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --output table --region "$AWS_REGION"
```

- `eb health` may still be `Ok`, because the web tier is unaffected.

### Troubleshoot

Check in this order:

1. A non-empty DLQ means messages were received and failed repeatedly — distinct from Drill 1, where messages were never received. Main-queue depth versus DLQ depth tells you which failure you have.
2. Read the worker log for the denied action and resource. IAM errors name both.
3. Note the blast radius: check whether the API is *also* failing. On this platform one policy change affects every container.

### Restore

```bash
aws iam put-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-name cloudtask-dev-application-permissions \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadApplicationSecret",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": ["${APP_SECRET_ARN}"]
    },
    {
      "Sid": "ExportQueue",
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"],
      "Resource": ["${QUEUE_ARN}"]
    },
    {
      "Sid": "ExportObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::${EXPORT_BUCKET_NAME}/exports/*"]
    }
  ]
}
JSON
)"

eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose restart worker api"
sleep 30

aws sqs start-message-move-task --source-arn "$DLQ_ARN" --region "$AWS_REGION"
```

### Verify

```bash
sleep 45
aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --output table --region "$AWS_REGION"
aws s3 ls "s3://$EXPORT_BUCKET_NAME/exports/" --recursive --region "$AWS_REGION"
```

Expected: the DLQ drains to zero and the previously failed exports appear in S3. The worker is idempotent — a conditional `UPDATE ... WHERE status <> 'completed'` claim plus a deterministic S3 key — so redelivery is safe. A DLQ is a repair queue, not a graveyard.

---

## 31. Drill 6 — exhaust the instance's memory

This drill has no equivalent in the ECS runbooks, because there each service has its own task with its own memory allocation. Here, four containers share one instance — so they can starve each other.

### Introduce failure

Raise the web container's memory limit past what the instance can supply, then force the containers to restart under the new limit:

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose ps -q | xargs -r sudo docker stats --no-stream"
```

Note the current usage, then consume the remaining memory from inside the api container:

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose exec -T api node -e \"const a=[];while(true){a.push(Buffer.alloc(10*1024*1024));}\" || true"
```

### Observe

- The api container is killed by the kernel's OOM killer and restarted by `restart: always`.
- Requests to `/api/v1/...` fail for the duration; `/` may keep working, because `web` is a separate container with its own limit.
- `eb health` degrades only if the load-balancer health check path is affected. Since it targets `/`, an api-only failure can leave the environment **green while the API is down** — a direct consequence of health-checking the web tier.
- The exit reason is visible on the instance:

```bash
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker inspect \$(sudo docker compose ps -q api) --format '{{.State.OOMKilled}} {{.State.ExitCode}} {{.RestartCount}}'"
```

Expected: `true 137 <n>` — `OOMKilled` true and exit code 137.

### Troubleshoot

Check in this order:

1. Exit code 137 with `OOMKilled: true` is unambiguous — the container exceeded its memory limit or the instance ran out.
2. `sudo docker stats --no-stream` shows per-container usage against limits. Sum the limits in `docker-compose.yml` and compare with the instance's total memory: `t3.small` has 2 GiB, of which the OS, Docker, and the Elastic Beanstalk health agent consume roughly 400–600 MiB.
3. Decide which fix applies: lower a `mem_limit`, or move to a larger instance type.

### Restore

The container restarts by itself once the allocating process is gone. Confirm:

```bash
sleep 20
curl -fsS "$PUBLIC_ORIGIN/health" && echo
eb ssh "$EB_ENV" --command "cd /var/app/current && sudo docker compose ps"
```

If the instance is genuinely too small for the workload, move up a size rather than shaving limits:

```bash
aws elasticbeanstalk update-environment --environment-name "$EB_ENV" \
  --region "$AWS_REGION" \
  --option-settings "Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.medium"

aws elasticbeanstalk wait environment-updated \
  --environment-names "$EB_ENV" --region "$AWS_REGION"
```

**Cost reminder:** `t3.medium` costs roughly twice `t3.small`. Change it back before you finish, or terminate the environment.

The architectural lesson: **co-located containers share a failure domain.** The worker competing with the web tier for memory on the same instance is not a bug in this configuration — it is what the platform's placement model implies. Scaling out for web traffic also scales the worker, whether the queue needs it or not.

---

## 32. Drills that do not apply to this deployment path

The manual and Terraform runbooks include eleven failure experiments. Several cannot be performed here, and understanding *why* is as useful as running the ones that can.

| Drill in the other runbooks | Why it does not apply here |
|---|---|
| Delete or misconfigure an ALB listener rule | Elastic Beanstalk owns the listener and reconciles changes away. Path routing lives in `nginx.conf` — the equivalent drill is breaking a `location` block, which is worth trying. |
| Detach a target group | Managed by the environment's CloudFormation stack; manual edits are reverted. |
| Delete the NAT Gateway | There is none — §3 explains the deliberate choice of public subnets. The analogous failure is removing `--vpc.publicip`, which breaks ECR pulls at instance launch. |
| Scale one service independently | **Not possible by design.** All four containers scale together with the instance count. This limitation *is* the lesson — see §31. |
| Revoke one service's IAM permissions | Not possible in isolation: all containers share the instance profile. §30 shows the wider blast radius instead. |

The general principle: **you cannot run a failure drill against a component you do not own, and you cannot isolate a failure to a component you did not isolate in the first place.**

---

# Part H — Troubleshooting framework

## 33. Troubleshooting decision tree

Work from the user-visible symptom inward. Every branch ends in a specific command.

### The four commands to reach for first

```text
eb status          -> environment health, version label, CNAME
eb events -f       -> ordered history of what the platform did and how it failed
eb health --refresh-> per-instance health and per-request metrics
eb logs --all      -> instance logs, including eb-engine.log
```

`eb events` is the one people skip and it is usually the fastest. It normally names the cause in one line.

### The environment is Severe or Degraded right after a deploy

```text
1. eb events -f
   -> read the newest entries first; deployment failures are named explicitly.
2. eb logs --all, then read eb-engine.log
   -> records the docker compose invocation and its full output.
3. Image pull failure / "manifest unknown"
   -> the GIT_SHA property does not match a pushed tag, or the instance profile
      lost AmazonEC2ContainerRegistryReadOnly. See §27.
4. Containers pull but exit immediately
   -> a configuration failure. Go to the next branch.
5. Remember: Elastic Beanstalk will NOT roll this back for you. See §27.
```

### Containers start and immediately exit

```text
eb ssh <env> --command "cd /var/app/current && sudo docker compose logs --tail 80"

Config validation errors listing several variables at once
  -> the generated .env is empty or missing. Check that no .env file is in the
     bundle (§18), then: sudo cut -d= -f1 /var/app/current/.env
"ENABLE_FAILURE_ENDPOINTS must never be true in production"
  -> the property is set. Remove it: eb setenv ENABLE_FAILURE_ENDPOINTS=
"JWT_SECRET must be at least 16 characters"
  -> the secret reference did not resolve, so the value is empty. Check the
     environmentsecrets option settings and the ARN's :KEY suffix (§23.2).
Exit code 137 / OOMKilled true
  -> memory. See §31.
exec format error
  -> the image was built for arm64. Rebuild with --platform linux/amd64 (§21).
```

### `/health` returns the Next.js 404 page

```text
-> the proxy routed an API path to the web container.
   The location blocks for /health and /ready must be EXACT matches
   (location = /health), because those routes sit outside the api/v1 prefix.
   Validate: docker run --rm <proxy image> nginx -t
   Then confirm on the instance:
   eb ssh <env> --command "cd /var/app/current && sudo docker compose exec -T nginx-proxy nginx -T" | grep -A2 'location'
```

### `/health` returns 200 but `/ready` does not

```text
503 + database unhealthy
  -> DATABASE_URL wrong, RDS unavailable, or the RDS security group does not
     allow $EB_SG. Confirm the group is attached to the instances:
     aws ec2 describe-instances --filters Name=tag:elasticbeanstalk:environment-name,Values=<env> \
       --query 'Reservations[].Instances[].SecurityGroups[].GroupId'
200 + status "degraded"
  -> Redis only. Check REDIS_TLS_ENABLED first, then the Redis security group.
     This is expected behavior, not an outage. See §28.
```

### The API works but exports never complete

```text
1. What does GET /exports/:id report?
   queued      -> nothing consumed the message. Check the worker container. See §26.
   processing  -> the worker picked it up and stalled. Read its log.
   failed      -> read errorCode, then the worker log.
2. Queue depth high, DLQ empty      -> no consumer running. See §26.
3. Queue depth low, DLQ non-empty   -> the consumer is failing. See §30.
4. Both empty but the status is queued -> the API never enqueued; check the
   instance profile's sqs:SendMessage permission.
```

### `eb health` is green but the application is broken

```text
This is the characteristic failure mode of this platform. Two causes:

1. The load balancer health check targets "/", which only exercises the web
   container. An api-only or worker-only failure leaves the environment green.
   -> Check each container directly:
      eb ssh <env> --command "cd /var/app/current && sudo docker compose ps"
   -> Consider pointing the health check at /health instead, so the check
      exercises the API through the proxy:
      aws elasticbeanstalk update-environment --environment-name <env> \
        --option-settings Namespace=aws:elasticbeanstalk:environment:process:default,OptionName=HealthCheckPath,Value=/health

2. Enhanced health has no request metrics because the healthd logs are not
   being written, so it is reporting instance health only.
   -> See §25.8.
```

### Where to look, by evidence type

```text
What the platform did            -> eb events -f
Deployment mechanics             -> eb logs --all, then eb-engine.log
Application behavior             -> docker compose logs, on the instance
Which containers are up          -> docker compose ps, on the instance
Why a container died             -> docker inspect: State.OOMKilled, State.ExitCode
Whether config reached the app   -> sudo cut -d= -f1 /var/app/current/.env
Request rate, latency, statuses  -> eb health --refresh
Async backlog                    -> sqs get-queue-attributes on the queue and DLQ
Worker throughput                -> CloudWatch namespace CloudTask/Dev, if log
                                    streaming is enabled (§34.2)
```

---

# Part I — Observability

## 34. Observability: what the platform gives you, and what it does not

### 34.1 — what enhanced health provides

Elastic Beanstalk's enhanced health is genuinely good at one thing: the HTTP request path.

```bash
eb health --refresh
```

It reports, per instance and for the environment: request count, latency percentiles (`p99`, `p90`, `p50`), status-code distribution, CPU load, and a colour-coded health status derived from all of it. That is more request-level insight than either ECS runbook gives you without building a dashboard, and you did not configure any of it — beyond writing the `healthd` log format in `nginx.conf`.

View the same data in the console under **Elastic Beanstalk → Environments → cloudtask-dev → Health**.

### 34.2 — stream container logs to CloudWatch

By default, logs live on the instances and disappear when an instance is replaced. For a lab where you want to read a failure after the fact, enable streaming:

```bash
aws elasticbeanstalk update-environment --environment-name "$EB_ENV" \
  --region "$AWS_REGION" \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:cloudwatch:logs,OptionName=StreamLogs,Value=true" \
    "Namespace=aws:elasticbeanstalk:cloudwatch:logs,OptionName=DeleteOnTerminate,Value=true" \
    "Namespace=aws:elasticbeanstalk:cloudwatch:logs,OptionName=RetentionInDays,Value=7"

aws elasticbeanstalk wait environment-updated \
  --environment-names "$EB_ENV" --region "$AWS_REGION"
```

`DeleteOnTerminate=true` removes the log groups when the environment is terminated, which keeps §35's cleanup honest. `RetentionInDays=7` keeps storage cost negligible.

### Verify

```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/elasticbeanstalk/${EB_ENV}" \
  --region "$AWS_REGION" \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output table
```

Expected: log groups for the platform logs with 7-day retention.

**Note:** this streams the *platform* logs — `eb-engine.log`, `nginx` access logs, and so on. Container stdout goes to the Docker daemon on the instance, so `docker compose logs` remains the way to read application output. To get container logs into CloudWatch as well, you would add an `awslogs` logging driver to each service in `docker-compose.yml`. That is a worthwhile extension and it is what the ECS runbooks get for free, because on ECS the log driver is part of the task definition.

### 34.3 — the metrics the application emits

The worker writes CloudWatch Embedded Metric Format lines to stdout, in the `CloudTask/Dev` namespace: `ExportsCompleted`, `ExportProcessingDurationMs`, and `ExportsFailed`.

```bash
aws cloudwatch list-metrics --namespace CloudTask/Dev --region "$AWS_REGION" \
  --query 'Metrics[].[MetricName]' --output table
```

Expected on this platform: **nothing.** This is worth understanding rather than treating as a bug.

EMF works by a log agent parsing structured JSON out of the log stream and converting it into metrics. On ECS the `awslogs` driver does that. Here, container stdout goes to the Docker daemon and never reaches CloudWatch Logs, so nothing parses the EMF lines and no metrics are created. The application is emitting them correctly; there is no consumer.

To fix it, add an `awslogs` driver to the worker service in `docker-compose.yml`:

```text
logging:
  driver: awslogs
  options:
    awslogs-region: ${AWS_REGION}
    awslogs-group: /ecs/cloudtask-dev-worker
    awslogs-create-group: 'true'
```

This requires `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` on the instance profile. Doing this is a good exercise: it makes explicit a piece of plumbing that the ECS task definition provided implicitly.

### 34.4 — the alarms you must build yourself

Enhanced health covers the request path. §26 showed it reports `Ok` with a dead worker, and §31 showed it can report `Ok` with a dead API. So the alarms below are not optional extras — they are the only signals that cover the parts of the system the platform cannot see.

```bash
export ALERT_TOPIC_ARN=$(aws sns create-topic --name cloudtask-dev-alerts \
  --tags $TAGS_EC2 --region "$AWS_REGION" --query TopicArn --output text)

aws sns subscribe --topic-arn "$ALERT_TOPIC_ARN" \
  --protocol email --notification-endpoint jubaer@subrite.no \
  --region "$AWS_REGION" --query SubscriptionArn --output text
```

**Confirm the subscription from your email before relying on it.** An unconfirmed subscription delivers nothing, which makes every alarm below decorative.

```bash
# The queue is backing up. This is the alarm that catches Drill 1 — the one
# enhanced health cannot see.
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

# Anything in the DLQ at all. Catches Drill 5.
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

# Environment health, as Elastic Beanstalk itself assesses it. 0 = Ok, 25 = Info,
# 15 = Unknown, 20 = No data, 10 = Warning, 5 = Degraded, 1 = Severe.
aws cloudwatch put-metric-alarm \
  --alarm-name cloudtask-dev-eb-environment-health \
  --alarm-description "Elastic Beanstalk environment health is Degraded or Severe" \
  --namespace AWS/ElasticBeanstalk --metric-name EnvironmentHealth \
  --dimensions Name=EnvironmentName,Value="$EB_ENV" \
  --statistic Maximum --period 60 --evaluation-periods 2 \
  --threshold 15 --comparison-operator GreaterThanOrEqualToThreshold \
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

**Note:** the `EnvironmentHealth` metric requires enhanced health reporting, which §16.1's service role enables. Its values are not ordered by severity in an intuitive way — `Severe` is `1` and `Ok` is `0` — so a simple "greater than" comparison cannot express "worse than Ok". The threshold above catches `Unknown`, `No data`, and `Info`; add a separate alarm on `EnvironmentHealth <= 5` if you also want `Degraded` and `Severe`, or use the `ApplicationRequests5xx` metric instead, which is easier to reason about.

### Verify

```bash
aws cloudwatch describe-alarms --alarm-name-prefix cloudtask-dev \
  --query 'MetricAlarms[].[AlarmName,StateValue,ActionsEnabled]' \
  --output table --region "$AWS_REGION"
```

Expected: four alarms, `OK` or `INSUFFICIENT_DATA` on a healthy idle system, with actions enabled.

Prove the notification path works before trusting any of them:

```bash
aws cloudwatch set-alarm-state \
  --alarm-name cloudtask-dev-export-dlq-not-empty \
  --state-value ALARM --state-reason "manual test of the notification path" \
  --region "$AWS_REGION"
```

Expected: an email arrives. An alarm that has never fired is a hypothesis, not a control.

---

# Part J — Cleanup

## 35. Cleanup

Cleanup here has **two distinct halves**, and this is where the most money is lost in this lab. `eb terminate` deletes what Elastic Beanstalk created. It does not touch anything from Part B, because Elastic Beanstalk never owned it.

```text
Deleted by `eb terminate`:
[ ] EC2 instances
[ ] Auto Scaling group
[ ] Application Load Balancer
[ ] Instance security group (the one EB created)
[ ] CloudFormation stack
[ ] Environment CloudWatch log groups (if DeleteOnTerminate was set)

NOT deleted — you must delete these yourself:
[ ] RDS instance, and its automated backups
[ ] ElastiCache replication group
[ ] DB and cache subnet groups
[ ] S3 export bucket
[ ] The S3 bucket EB created for application versions
[ ] SQS queue and DLQ
[ ] ECR repositories
[ ] Secrets Manager secret
[ ] CloudWatch alarms and the SNS topic
[ ] The security groups you created in §9
[ ] IAM roles and the instance profile
[ ] The Elastic Beanstalk application object
```

**Critical cost reminder:** work through both halves in one sitting. A half-finished teardown is the most expensive state this lab can be left in, because the costly items — instances, load balancer, RDS, Redis, public IPv4 addresses — bill whether you use them or not.

### Step 35.1 — terminate the environment

```bash
cd deploy/beanstalk
eb terminate "$EB_ENV" --force

aws elasticbeanstalk wait environment-terminated \
  --environment-names "$EB_ENV" --region "$AWS_REGION"
```

### Step 35.2 — delete the application and its versions

The application object is free, but the S3 bucket holding every version you ever deployed is not.

```bash
aws elasticbeanstalk delete-application \
  --application-name "$EB_APP" \
  --terminate-env-by-force \
  --region "$AWS_REGION"
```

Then find and empty the versions bucket, which Elastic Beanstalk names `elasticbeanstalk-<region>-<account-id>`:

```bash
export EB_BUCKET="elasticbeanstalk-${AWS_REGION}-${AWS_ACCOUNT_ID}"

aws s3 ls "s3://$EB_BUCKET/" --region "$AWS_REGION" 2>/dev/null \
  && aws s3 rm "s3://$EB_BUCKET/resources/environments/" --recursive --region "$AWS_REGION" \
  && aws s3 rm "s3://$EB_BUCKET/${EB_APP}/" --recursive --region "$AWS_REGION"
```

**Note:** do **not** delete the `elasticbeanstalk-<region>-<account-id>` bucket itself if you intend to use Elastic Beanstalk again in this Region — it is shared across all applications in the account. Emptying the paths above is enough. It also carries a bucket policy that Elastic Beanstalk expects to exist.

### Step 35.3 — the data and messaging layer

```bash
# RDS. --skip-final-snapshot and --delete-automated-backups are correct ONLY
# for a disposable lab; retained snapshots bill after the instance is gone.
aws rds delete-db-instance \
  --db-instance-identifier cloudtask-dev-postgres \
  --skip-final-snapshot --delete-automated-backups \
  --region "$AWS_REGION" --query 'DBInstance.DBInstanceStatus' --output text

aws rds wait db-instance-deleted \
  --db-instance-identifier cloudtask-dev-postgres --region "$AWS_REGION"

# ElastiCache.
aws elasticache delete-replication-group \
  --replication-group-id cloudtask-dev-redis \
  --no-retain-primary-cluster \
  --region "$AWS_REGION" --query 'ReplicationGroup.Status' --output text

aws elasticache wait replication-group-deleted \
  --replication-group-id cloudtask-dev-redis --region "$AWS_REGION"

# Subnet groups, after the resources that used them.
aws rds delete-db-subnet-group \
  --db-subnet-group-name cloudtask-dev-eb-db-subnets --region "$AWS_REGION"
aws elasticache delete-cache-subnet-group \
  --cache-subnet-group-name cloudtask-dev-eb-redis-subnets --region "$AWS_REGION"

# S3 export bucket.
aws s3 rm "s3://$EXPORT_BUCKET_NAME" --recursive --region "$AWS_REGION"
aws s3api delete-bucket --bucket "$EXPORT_BUCKET_NAME" --region "$AWS_REGION"

# SQS.
aws sqs delete-queue --queue-url "$EXPORT_QUEUE_URL" --region "$AWS_REGION"
aws sqs delete-queue --queue-url "$DLQ_URL" --region "$AWS_REGION"
```

### Step 35.4 — monitoring, images, secrets, security groups, IAM

```bash
aws cloudwatch delete-alarms --alarm-names \
  cloudtask-dev-export-queue-age \
  cloudtask-dev-export-dlq-not-empty \
  cloudtask-dev-eb-environment-health \
  cloudtask-dev-rds-cpu-high \
  --region "$AWS_REGION"

aws sns delete-topic --topic-arn "$ALERT_TOPIC_ARN" --region "$AWS_REGION"

for app in api worker web; do
  aws ecr delete-repository --repository-name "cloudtask-dev-${app}" \
    --force --region "$AWS_REGION" --query 'repository.repositoryName' --output text
done

# Force immediate deletion: Secrets Manager otherwise bills for the secret
# during its 7-to-30-day recovery window.
aws secretsmanager delete-secret --secret-id "$SECRET_NAME" \
  --force-delete-without-recovery --region "$AWS_REGION" \
  --query '[Name,DeletionDate]' --output table

# Security groups: dependents before the group they reference.
aws ec2 delete-security-group --group-id "$RDS_SG"   --region "$AWS_REGION"
aws ec2 delete-security-group --group-id "$REDIS_SG" --region "$AWS_REGION"
aws ec2 delete-security-group --group-id "$EB_SG"    --region "$AWS_REGION"
```

If a security group delete fails with `DependencyViolation`, an instance or network interface still exists. Instance termination takes a few minutes to release them — wait and retry. To find the holder:

```bash
aws ec2 describe-network-interfaces \
  --filters Name=group-id,Values="$EB_SG" \
  --query 'NetworkInterfaces[].[NetworkInterfaceId,Status,Description]' \
  --output table --region "$AWS_REGION"
```

IAM roles and instance profiles:

```bash
aws iam delete-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-name cloudtask-dev-application-permissions 2>/dev/null

aws iam remove-role-from-instance-profile \
  --instance-profile-name aws-elasticbeanstalk-ec2-role \
  --role-name aws-elasticbeanstalk-ec2-role
aws iam delete-instance-profile \
  --instance-profile-name aws-elasticbeanstalk-ec2-role

aws iam detach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier
aws iam detach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
aws iam delete-role --role-name aws-elasticbeanstalk-ec2-role

aws iam detach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth
aws iam detach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy
aws iam delete-role --role-name aws-elasticbeanstalk-service-role
```

**Decide deliberately about the two shared roles.** `aws-elasticbeanstalk-service-role` and `aws-elasticbeanstalk-ec2-role` use AWS's conventional names, not `cloudtask-` names, and any other Elastic Beanstalk environment in this account depends on them. IAM roles are free. **Delete the inline policy and the instance profile, but leave the roles**, unless you are certain nothing else uses them.

---

## 36. Post-destroy verification

Run every check. A teardown you have not verified is a teardown that did not happen.

### 36.1 EC2 instances and Auto Scaling groups

```bash
aws ec2 describe-instances --region "$AWS_REGION" \
  --filters Name=instance-state-name,Values=running,pending,stopping,stopped \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,Tags[?Key==`Name`].Value|[0]]' \
  --output table

aws autoscaling describe-auto-scaling-groups --region "$AWS_REGION" \
  --query 'AutoScalingGroups[].[AutoScalingGroupName,DesiredCapacity]' --output table
```

Expected: no lab instances and no lab Auto Scaling group. **Stopped instances still bill for their EBS volumes.**

### 36.2 Load balancers and target groups

```bash
aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --query 'LoadBalancers[].[LoadBalancerName,State.Code]' --output table
aws elbv2 describe-target-groups --region "$AWS_REGION" \
  --query 'TargetGroups[].[TargetGroupName]' --output table
```

Expected: neither exists for this lab.

### 36.3 Elastic Beanstalk applications and environments

```bash
aws elasticbeanstalk describe-environments --region "$AWS_REGION" \
  --query 'Environments[].[EnvironmentName,Status,Health]' --output table
aws elasticbeanstalk describe-applications --region "$AWS_REGION" \
  --query 'Applications[].[ApplicationName]' --output table
```

Expected: no `cloudtask` application, and no environment in any state other than `Terminated`.

### 36.4 CloudFormation stacks

```bash
aws cloudformation describe-stacks --region "$AWS_REGION" \
  --query 'Stacks[?starts_with(StackName,`awseb-`)].[StackName,StackStatus]' \
  --output table
```

Expected: no `awseb-` stack for this environment. A stack stuck in `DELETE_FAILED` holds resources that are still billing — open it in the console and read the failure reason.

### 36.5 RDS, including snapshots and automated backups

```bash
aws rds describe-db-instances --region "$AWS_REGION" \
  --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus]' --output table
aws rds describe-db-snapshots --region "$AWS_REGION" --snapshot-type manual \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,AllocatedStorage]' --output table
aws rds describe-db-instance-automated-backups --region "$AWS_REGION" \
  --query 'DBInstanceAutomatedBackups[].[DBInstanceIdentifier,Status]' --output table
```

Expected: all three empty of project resources. **Snapshots and automated backups bill after the instance is gone** — the most commonly missed line item in the whole teardown.

### 36.6 ElastiCache

```bash
aws elasticache describe-replication-groups --region "$AWS_REGION" \
  --query 'ReplicationGroups[].[ReplicationGroupId,Status]' --output table
aws elasticache describe-cache-clusters --region "$AWS_REGION" \
  --query 'CacheClusters[].[CacheClusterId,CacheClusterStatus]' --output table
```

Expected: no project Redis resources.

### 36.7 EBS volumes, snapshots, and public IPv4 addresses

```bash
aws ec2 describe-volumes --region "$AWS_REGION" \
  --query 'Volumes[?State==`available`].[VolumeId,Size,State]' --output table
aws ec2 describe-snapshots --owner-ids "$AWS_ACCOUNT_ID" --region "$AWS_REGION" \
  --query 'Snapshots[].[SnapshotId,VolumeSize]' --output table
aws ec2 describe-addresses --region "$AWS_REGION" \
  --query 'Addresses[].[PublicIp,AssociationId]' --output table
```

Expected: no orphaned volumes, no lab snapshots, and no Elastic IPs. Detached EBS volumes bill at full price, and public IPv4 addresses bill hourly whether attached or not.

### 36.8 S3, SQS, ECR, log groups, and secrets

```bash
aws s3 ls | grep cloudtask || echo "no cloudtask buckets"
aws sqs list-queues --queue-name-prefix cloudtask --region "$AWS_REGION" \
  --output table 2>/dev/null || echo "no cloudtask queues"
aws ecr describe-repositories --region "$AWS_REGION" \
  --query 'repositories[].repositoryName' --output table 2>/dev/null \
  || echo "no repositories"
aws logs describe-log-groups --region "$AWS_REGION" \
  --query 'logGroups[?contains(logGroupName,`elasticbeanstalk`) || contains(logGroupName,`cloudtask`)].logGroupName' \
  --output table
aws secretsmanager list-secrets --region "$AWS_REGION" \
  --query 'SecretList[?contains(Name,`cloudtask`)].[Name,DeletedDate]' --output table
```

Expected: none of these exist for the project — including no secret pending deletion.

### 36.9 Tag-based sweep

The single most useful check, because it does not depend on you remembering every resource type:

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=cloudtask \
  --region "$AWS_REGION" \
  --query 'ResourceTagMappingList[].ResourceARN' --output table
```

Expected: empty. Anything listed here still exists and may still bill.

### 36.10 Billing review

Check **Billing and Cost Management → Cost Explorer** the day after teardown, grouped by service, filtered to this Region. Yesterday's usage should trend to zero. Anything still accruing is something the checks above missed — and EC2 and Elastic Load Balancing are the two lines to look at first.

---

## 37. Cleanup sign-off and lab journal

### Sign-off table

| Resource category | Expected after cleanup | Verified |
|---|---:|---|
| EC2 instances | none | [ ] |
| Auto Scaling group | deleted | [ ] |
| Application Load Balancer | none | [ ] |
| Target groups | none | [ ] |
| EB environment | terminated | [ ] |
| EB application | deleted | [ ] |
| EB versions in S3 | emptied | [ ] |
| CloudFormation stack | deleted | [ ] |
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
| Security groups created in §9 | deleted | [ ] |
| IAM inline policy and instance profile | deleted | [ ] |
| EBS volumes and snapshots | none orphaned | [ ] |
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
Did `eb health` notice? (yes/no):
Evidence source (eb events / eb logs / docker compose logs / CloudWatch):
Root cause:
Repair:
Time to detect:
Time to recover:
Preventive control:
```

The `eb health` line is specific to this runbook and it is the most instructive column in the table. Fill it in for every drill, then count how many failures the platform's own health model missed.

Two questions worth answering in prose at the end:

```text
Which failures did Elastic Beanstalk handle better than I expected?
Which failures did co-locating four containers on one instance make worse?
```

---

## 38. Completion criteria

The lab is complete only when you can explain and demonstrate all of the following:

1. Why this runbook uses the `Docker running on AL2023` platform branch rather than the ECS-managed one, quoting AWS's own recommendation.
2. How traffic reaches a container: which container owns host port 80, and why the platform's own reverse proxy is not in the path.
3. How an environment property becomes a value inside a container — all four steps — and what happens if a `.env` file is present in the bundle.
4. Why ECR authentication needed no `.dockercfg` and no `docker login` hook.
5. Why `NEXT_PUBLIC_API_BASE_URL` could be the relative path `/api/v1` here but not in the Express Mode runbook.
6. Why `/health` and `/ready` are exact-match locations in `nginx.conf` rather than prefixes.
7. Why `X-Forwarded-For` matters to the API's rate limiter, and what breaks without it.
8. From §26 and §31: two distinct ways `eb health` can report `Ok` while the application is broken, and which signal catches each.
9. From §27: that Elastic Beanstalk does not roll back a failed container start, what the recovery procedure is, and how your measured recovery time compares with the Express Mode canary rollback.
10. From §29: why changing a secret in Secrets Manager does not affect a running environment, and why that is both a safety net and a trap.
11. From §30 and §31: two consequences of sharing one instance profile and one instance across four containers, and what the specification's §15 asks for instead.
12. Why the worker's EMF metrics do not appear in CloudWatch on this platform, and what you would add to make them appear.
13. Which resources `eb terminate` deletes and which it does not — from memory, not by re-reading §35.
14. Every item in the §37 sign-off table verified, and the next-day bill trending to zero.

If you cannot answer these from your own notes rather than by re-reading this document, the drills in Part G are worth repeating.
