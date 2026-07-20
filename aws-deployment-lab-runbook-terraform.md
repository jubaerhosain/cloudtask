# CloudTask AWS Deployment, Failure-Testing, Troubleshooting, and Cleanup Runbook

## 1. Purpose

This is a hands-on AWS lab for deploying the CloudTask application specified in `application-spec.md`. Follow it in sequence. It covers account preparation, Terraform deployment, application release, validation, controlled failures, troubleshooting, and deletion of costly resources.

## 2. Cost warning

This environment can incur charges. The most important potentially billable resources include:

- NAT Gateway and its data processing
- Public IPv4 addresses
- Application Load Balancer
- ECS Fargate tasks
- RDS instance and storage
- ElastiCache node
- CloudWatch logs, metrics, alarms, and dashboards
- S3 storage and requests
- ECR image storage
- SQS requests

Use a short-lived `dev` environment. Plan to destroy it the same day unless you intentionally need it longer.

## 3. Mandatory tag set

Apply these values to every taggable resource:

```text
Project=cloudtask
Environment=dev
Owner=jubaer
ManagedBy=terraform
Purpose=aws-learning
CostCenter=personal-learning
ExpiresOn=<planned deletion date, YYYY-MM-DD>
```

### Tagging rule

Verify that Terraform provider `default_tags` is active so every resource is tagged automatically. For any manually created resource, add all mandatory tags immediately.

## 4. Day 0 — account safety and local preparation

### Step 4.1 — choose a region

Use one region for the entire lab, for example `ap-southeast-1` or another region near you that supports all selected services.

Set:

```bash
export AWS_REGION=ap-southeast-1
export AWS_DEFAULT_REGION="$AWS_REGION"
```

**Note:** Record the region in the project README and do not create project resources in a second region accidentally.

### Step 4.2 — secure the AWS account

Before deployment:

1. Enable MFA for the root user.
2. Do not use root for daily work.
3. Use IAM Identity Center or a dedicated administrative role for the lab.
4. Do not create long-lived access keys unless temporarily necessary.
5. Never commit credentials.

Verify identity:

```bash
aws sts get-caller-identity
```

Expected: your account ID and the role/user ARN you intended to use.

### Step 4.3 — create a budget

In **Billing and Cost Management -> Budgets**:

1. Create a monthly cost budget appropriate for your account.
2. Add alerts at low thresholds meaningful to you.
3. Add your email address.

Budgets may not stop resources automatically. They are alerts, not a guaranteed kill switch.

**Note:** Activate project cost-allocation tags under Billing -> Cost allocation tags after resources begin appearing.

### Step 4.4 — enable Resource Explorer

1. Open AWS Resource Explorer.
2. Enable indexes in the lab region.
3. Create an aggregator index if you need multi-region search.
4. Test a search such as `tag:Project=cloudtask` after deployment.

Resource Explorer is useful for inventory, but do not treat it as the only cleanup check.

### Step 4.5 — install tools locally

Required:

```bash
aws --version
docker --version
terraform version
node --version
pnpm --version
```

Recommended:

```bash
trivy --version
tflint --version
jq --version
```

### Step 4.6 — clone and initialize the repository

```bash
git clone <your-repository-url> cloudtask
cd cloudtask
pnpm install
cp .env.example .env
```

Do not put production AWS secrets in `.env`.

## 5. Day 1 — run and test locally

### Step 5.1 — start dependencies and applications

```bash
pnpm install
docker compose up --build
```

Expected services:

- web
- api
- worker
- postgres
- redis

### Step 5.2 — run migrations

```bash
pnpm --filter api migration:run
```

### Step 5.3 — run automated tests

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
```

Do not deploy if fundamental local tests fail.

### Step 5.4 — manual functional test

1. Register a user.
2. Log in.
3. Create a project.
4. Create at least three tasks.
5. Filter tasks by status.
6. Request a CSV export.
7. Confirm the worker processes it.
8. Download and inspect the CSV.

### Step 5.5 — local failure drill: stop Redis

```bash
docker compose stop redis
```

Test:

- Project list still loads.
- Summary still computes from PostgreSQL.
- `/ready` reports Redis degraded.
- Logs contain a Redis warning without exposing secrets.

Restore:

```bash
docker compose start redis
```

### Step 5.6 — local failure drill: stop PostgreSQL

```bash
docker compose stop postgres
```

Test:

- `/health` returns 200.
- `/ready` returns 503.
- Business API returns a controlled error.

Restore:

```bash
docker compose start postgres
```

## 6. Day 2 — prepare Terraform

### Step 6.1 — configure provider default tags

In `providers.tf`:

```hcl
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      Owner       = var.owner
      ManagedBy   = "terraform"
      Purpose     = "aws-learning"
      CostCenter  = "personal-learning"
      ExpiresOn   = var.expires_on
    }
  }
}
```

**Before applying:** ensure `expires_on` is set and provider default tags are visible in the plan.

### Step 6.2 — create `terraform.tfvars`

Example:

```hcl
aws_region              = "ap-southeast-1"
project_name            = "cloudtask"
environment             = "dev"
owner                   = "jubaer"
expires_on              = "2026-12-31" # set to your planned deletion date
enable_nat_gateway      = true
api_image_tag           = "bootstrap"
worker_image_tag        = "bootstrap"
web_image_tag           = "bootstrap"
database_instance_class = "db.t4g.micro"
redis_node_type         = "cache.t4g.micro"
```

Verify current regional support and price before selecting instance classes. If an ARM class is selected, container images must support ARM64 or use architecture-compatible settings.

### Step 6.3 — format and validate

```bash
cd infrastructure/terraform/environments/dev
terraform fmt -recursive
terraform init
terraform validate
terraform plan -out=tfplan
```

Review the plan carefully.

Check:

- Region is correct.
- Resource name prefix is `cloudtask-dev`.
- Mandatory tags are present.
- RDS is not publicly accessible.
- Redis is not publicly accessible.
- Security groups do not expose 5432 or 6379 publicly.
- NAT Gateway count is exactly what you expect.
- ECS desired counts are small.
- S3 public access block is enabled.
- S3 export bucket has a 7-day expiration lifecycle rule.
- No accidental multi-AZ RDS or large instance class.

**Before approval:** search the plan output for `Project`, `Environment`, `Owner`, and `ExpiresOn`.

## 7. Day 3 — create foundational AWS resources

A clean implementation may deploy everything with one `terraform apply`. For learning, inspect each resource group as Terraform creates it.

### Step 7.1 — apply infrastructure

```bash
terraform apply tfplan
```

Save outputs:

```bash
terraform output -json > terraform-outputs.json
```

### Step 7.2 — inspect VPC resources

Open **VPC -> Your VPCs** and verify:

- One project VPC.
- Two public subnets.
- Two private app subnets.
- Two private data subnets.
- Internet Gateway attached.
- NAT Gateway available if enabled.
- Correct route table associations.

Expected routes:

Public route table:

```text
VPC CIDR -> local
0.0.0.0/0 -> Internet Gateway
```

Private app route table:

```text
VPC CIDR -> local
0.0.0.0/0 -> NAT Gateway
```

Private data route table:

```text
VPC CIDR -> local
```

### Step 7.3 — inspect security groups

Verify all six security groups (ALB, web, API, worker, RDS, Redis):

- ALB: inbound HTTP from internet; outbound to the web and API security groups.
- Web: inbound only from the ALB security group; no database or Redis egress.
- API: inbound only from the ALB security group; egress to RDS, Redis, and HTTPS.
- Worker: no inbound rules; egress to RDS and HTTPS only (no Redis).
- RDS: inbound 5432 only from API and worker security groups.
- Redis: inbound 6379 only from the API security group.

### Step 7.4 — inspect ECR

Open ECR and verify repositories exist for web, API, and worker.

### Step 7.5 — inspect databases and queues

Verify:

- RDS status becomes `Available`.
- RDS public access is `No`.
- ElastiCache becomes available.
- SQS main queue and DLQ exist.
- S3 export bucket is private.
- S3 export bucket has a lifecycle rule expiring objects after 7 days (the spec's dev retention).
- Secrets Manager secrets exist without printing their values.

**Note:** Some generated child resources may not support all tags; record any exceptions.

## 8. Day 3 — build and push images

### Step 8.1 — authenticate Docker to ECR

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

### Step 8.2 — choose immutable image tag

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)
echo "$IMAGE_TAG"
```

Do not use only `latest` for deployments.

### Step 8.3 — build images

For x86_64 Fargate:

```bash
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile -t cloudtask-api:$IMAGE_TAG --load .
docker buildx build --platform linux/amd64 -f apps/worker/Dockerfile -t cloudtask-worker:$IMAGE_TAG --load .
docker buildx build --platform linux/amd64 -f apps/web/Dockerfile -t cloudtask-web:$IMAGE_TAG --load .
```

Use `linux/arm64` only when task definitions and dependencies support it.

### Step 8.4 — tag and push

Use Terraform ECR outputs:

```bash
API_REPO=$(terraform output -raw api_ecr_repository_url)
WORKER_REPO=$(terraform output -raw worker_ecr_repository_url)
WEB_REPO=$(terraform output -raw web_ecr_repository_url)

docker tag cloudtask-api:$IMAGE_TAG "$API_REPO:$IMAGE_TAG"
docker tag cloudtask-worker:$IMAGE_TAG "$WORKER_REPO:$IMAGE_TAG"
docker tag cloudtask-web:$IMAGE_TAG "$WEB_REPO:$IMAGE_TAG"

docker push "$API_REPO:$IMAGE_TAG"
docker push "$WORKER_REPO:$IMAGE_TAG"
docker push "$WEB_REPO:$IMAGE_TAG"
```

### Step 8.5 — scan images

```bash
trivy image "$API_REPO:$IMAGE_TAG"
trivy image "$WORKER_REPO:$IMAGE_TAG"
trivy image "$WEB_REPO:$IMAGE_TAG"
```

Fix critical application vulnerabilities before treating the deployment as complete.

**Note:** ECR repository resource tags and Docker image tags are separate; use immutable image tags for deployments.

## 9. Day 3 — deploy ECS services

### Step 9.1 — update Terraform image tags

Update `terraform.tfvars`:

```hcl
api_image_tag    = "<git-sha>"
worker_image_tag = "<git-sha>"
web_image_tag    = "<git-sha>"
```

Then:

```bash
terraform plan -out=release.tfplan
terraform apply release.tfplan
```

### Step 9.2 — observe ECS deployment

Open **ECS -> Clusters -> cloudtask-dev**.

Verify:

- Web service desired/running count: 1/1.
- API service desired/running count: 1/1.
- Worker service desired/running count: 1/1.
- Tasks use Fargate.
- API and web targets become healthy.
- Worker has no load balancer.

Inspect service events for errors.

**Note:** Enable tag propagation from ECS service to tasks.

### Step 9.3 — inspect CloudWatch logs

Open log groups:

- `/cloudtask/dev/web`
- `/cloudtask/dev/api`
- `/cloudtask/dev/worker`

Verify:

- Startup logs are present.
- Logs are JSON.
- No secret value is printed.
- Retention is 7 days.

## 10. Day 4 — production-style validation

### Step 10.1 — open the application

```bash
terraform output -raw application_url
```

Open the URL in a browser.

### Step 10.2 — smoke test

Perform:

1. Register.
2. Login.
3. Create a project.
4. Create tasks of each priority.
5. Change statuses.
6. Filter and paginate.
7. Refresh the page.
8. Log out and back in.

### Step 10.3 — authorization test

Create a second user.

Try to access the first user's project ID using the second user's token.

Expected:

- 404 or 403 according to the chosen security convention.
- No project data leakage.
- A structured log line with request ID.

### Step 10.4 — export workflow test

1. Request export.
2. Open SQS metrics and confirm message activity.
3. Open worker logs and follow the export ID.
4. Confirm database status becomes completed.
5. Confirm S3 object exists.
6. Download through the presigned URL.
7. Verify S3 object is not public.

### Step 10.5 — readiness and health test

```bash
APP_URL=$(terraform output -raw application_url)
curl -i "$APP_URL/health"
curl -i "$APP_URL/ready"
```

Expected healthy response codes: 200.

### Step 10.6 — inspect dashboard

Open the `cloudtask-dev` CloudWatch dashboard and confirm widgets show data for:

- ALB (request count, target 5xx, target response time)
- ECS (API and worker CPU/memory, running task counts)
- SQS (visible messages, age of oldest message)
- RDS (CPU, database connections)
- ElastiCache (CPU, current connections)
- Custom export metrics

The custom metrics live in namespace `CloudTask/Dev`. After running at least one export, open **CloudWatch -> Metrics -> CloudTask/Dev** and confirm these appear:

- `ExportsCompleted`
- `ExportsFailed`
- `ExportProcessingDurationMs`

### Step 10.7 — verify alarms and SNS topic

Terraform creates an SNS topic (`cloudtask-dev-alerts`; email subscription is optional and added manually) and the specification's five alarms, all actioned to that topic. Confirm each exists in **CloudWatch -> Alarms**:

1. ALB target 5xx count > 5 in 5 minutes.
2. API running task count < 1 for 2 periods.
3. SQS age of oldest message > 300 seconds.
4. DLQ visible messages ≥ 1.
5. RDS CPU > 80% for 10 minutes.

## 11. Day 5 — controlled failure experiments

Only perform one failure at a time. Record the start time, expected symptom, actual symptom, evidence, repair action, and resolution time.

### Experiment A — stop the worker

#### Create failure

Set worker desired count to zero temporarily:

```bash
aws ecs update-service \
  --cluster cloudtask-dev \
  --service cloudtask-dev-worker \
  --desired-count 0
```

This manual drift is deliberate.

#### Test

1. Request an export.
2. Confirm API returns 202.
3. Confirm SQS visible messages increases.
4. Confirm age of oldest message increases.
5. Confirm the queue-age alarm eventually changes state if threshold is reached.

#### Troubleshoot

Check:

```bash
aws ecs describe-services \
  --cluster cloudtask-dev \
  --services cloudtask-dev-worker

aws sqs get-queue-attributes \
  --queue-url "$(terraform output -raw export_queue_url)" \
  --attribute-names ApproximateNumberOfMessages ApproximateAgeOfOldestMessage
```

#### Repair

Restore through Terraform, not only CLI:

```bash
terraform apply
```

Expected: worker returns to desired count 1 and drains the queue.

### Experiment B — deploy a nonexistent image tag

#### Create failure

Temporarily set API image tag to a nonexistent value:

```hcl
api_image_tag = "does-not-exist"
```

Apply:

```bash
terraform apply
```

#### Expected symptoms

- New task fails to pull the image.
- ECS service events show image pull failure.
- Stopped-task reason indicates image cannot be pulled.
- Existing healthy API task should remain if rolling-deployment settings and capacity permit.
- Deployment circuit breaker should fail and roll back when configured.

#### Troubleshoot

Inspect:

```bash
aws ecs describe-services \
  --cluster cloudtask-dev \
  --services cloudtask-dev-api

aws ecs list-tasks \
  --cluster cloudtask-dev \
  --service-name cloudtask-dev-api \
  --desired-status STOPPED
```

Then describe the newest stopped task.

#### Repair

Restore the known-good Git SHA and apply Terraform.

**Note:** Repair the Terraform-managed service; do not create an ad hoc replacement.

### Experiment C — break the ALB health check path

#### Create failure

Temporarily change target-group health check path from `/health` to `/wrong-health` through Terraform.

#### Expected symptoms

- Targets become unhealthy.
- ALB returns 503 when no healthy target remains.
- ECS may repeatedly replace tasks depending on service configuration.
- Target health reason shows response-code mismatch.

#### Troubleshoot

```bash
TG_ARN=$(terraform output -raw api_target_group_arn)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN"
```

Review API logs to confirm the wrong path is requested.

#### Repair

Set the path back to `/health` and apply.

### Experiment D — remove worker SQS permission

#### Create failure

Through Terraform, temporarily remove `sqs:ReceiveMessage` from the worker task role policy and deploy a new task definition/service update.

#### Expected symptoms

- Worker logs show AccessDenied.
- Queue messages accumulate.
- Worker process should remain alive with controlled retry/backoff rather than crash-looping rapidly.

#### Troubleshoot

Check:

- Worker CloudWatch logs.
- Worker task role ARN.
- IAM policy simulator or IAM policy document.
- CloudTrail event history for denied calls when available.

#### Repair

Restore minimum required actions:

- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:ChangeMessageVisibility`
- `sqs:GetQueueAttributes`

Apply Terraform and verify queue drains.

**Note:** Name IAM roles and policies `cloudtask-dev-*`; IAM tag-search support varies by tool.

### Experiment E — force application errors

Create an explicitly dev-only endpoint or feature flag such as:

`POST /api/v1/debug/fail?type=500`

Requirements:

- Enabled only when `ENABLE_FAILURE_ENDPOINTS=true`.
- Protected by authentication.
- Never enabled in production.

Generate more than five controlled 500 responses.

Expected:

- ALB target 5xx metric increases.
- Alarm changes state when threshold is met.
- Logs contain request IDs and stack traces without secrets.

Repair by disabling the flag and releasing a new task definition.

### Experiment F — Redis outage simulation

Because ElastiCache actions may create operational risk and take time, prefer application-level simulation:

1. Temporarily set an invalid Redis endpoint in a dev task-definition revision, or
2. Temporarily modify Redis security group ingress through Terraform.

Expected:

- `/ready` reports degraded.
- Project summaries still work using PostgreSQL.
- Logs show connection errors with backoff.
- API does not crash repeatedly.

Repair using Terraform.

**Note:** Do not create a second Redis cluster as a shortcut.

### Experiment G — database connectivity failure

Temporarily remove API/worker ingress from the RDS security group using Terraform.

Expected:

- `/health` remains 200.
- `/ready` becomes 503.
- Business requests fail in a controlled manner.
- RDS itself remains available.

Repair the security-group references through Terraform.

Do not make RDS publicly accessible for troubleshooting.

### Experiment H — poison message and DLQ

Send a deliberately invalid message to the queue:

```bash
aws sqs send-message \
  --queue-url "$(terraform output -raw export_queue_url)" \
  --message-body '{"schemaVersion":999,"bad":true}'
```

Expected:

- Worker rejects the message with a validation error.
- It is retried according to visibility timeout.
- After `maxReceiveCount=3`, it moves to the DLQ.
- DLQ alarm changes state.

Troubleshoot:

```bash
aws sqs get-queue-attributes \
  --queue-url "$(terraform output -raw export_dlq_url)" \
  --attribute-names ApproximateNumberOfMessages
```

After learning, purge or delete through the final Terraform destroy. Do not manually redrive an invalid message to the main queue.

## 12. Troubleshooting decision tree

### Application URL does not open

Check in order:

1. Is the ALB active?
2. Does the listener have the expected rule?
3. Are target groups healthy?
4. Are ECS desired and running counts equal?
5. Are security-group rules correct?
6. Does the task bind to `0.0.0.0`, not only localhost?
7. Is the container port correct?
8. Do CloudWatch logs show startup failure?

Commands:

```bash
aws elbv2 describe-load-balancers
aws ecs describe-services --cluster cloudtask-dev --services cloudtask-dev-web cloudtask-dev-api
```

### ECS task remains pending or stops

Inspect:

- ECS service events
- Stopped-task reason
- ECR image architecture
- Image tag existence
- Task execution-role permissions
- Private subnet route to NAT Gateway
- Available subnet IP addresses
- CPU/memory combination validity
- Secrets Manager permissions

### `ResourceInitializationError`

Common causes:

- No route from private subnet to ECR/CloudWatch/Secrets Manager.
- NAT Gateway unavailable.
- DNS settings disabled in VPC.
- Execution role missing permissions.
- Secret ARN or log group missing.

### ALB target unhealthy

Check:

- Health path exactly `/health`.
- Endpoint returns quickly without database dependency.
- Correct port mapping.
- API/web security group accepts traffic from ALB security group.
- Application listens on `0.0.0.0`.
- Health-check success code matcher.

### RDS connection timeout

Check:

- RDS status available.
- Correct endpoint and port.
- API/worker and RDS are in the same VPC.
- RDS security group references API/worker security groups.
- Route tables retain local VPC route.
- Database credentials are current.
- TLS settings match client requirements.

Do not solve this by opening port 5432 to the internet.

### Redis timeout

Check:

- Correct endpoint and port.
- Redis security group allows API security group.
- TLS setting matches cluster configuration.
- DNS resolution works.
- Application fallback is functioning.

### SQS queue grows

Check:

- Worker desired/running count.
- Worker logs.
- Worker task-role permissions.
- Visibility timeout longer than normal processing time.
- Poison messages and DLQ count.
- Database or S3 errors preventing completion.

### S3 upload AccessDenied

Check:

- Worker task role, not execution role.
- Exact bucket ARN and object ARN pattern.
- Required `s3:PutObject` permission.
- Bucket policy deny statements.
- Encryption permissions if a customer-managed KMS key is used.

## 13. Cost observation during the lab

### Step 13.1 — inspect Cost Explorer

Cost Explorer data is not immediate. Check later and group by:

- Service
- Region
- Tag `Project`
- Tag `Environment`

Cost-allocation tags must be activated before useful reporting and are not retrospective.

### Step 13.2 — inspect current resources by tag

Resource Explorer query examples:

```text
tag:Project=cloudtask

tag:Environment=dev
```

Tag Editor:

1. Open Resource Groups -> Tag Editor.
2. Select all regions or the lab region.
3. Filter `Project=cloudtask`.
4. Look for untagged project resources as well.

### Step 13.3 — check high-risk resources manually

Always inspect:

- VPC -> NAT Gateways
- EC2 -> Elastic IP addresses
- EC2 -> Load Balancers
- ECS -> Clusters and services
- RDS -> Databases and snapshots
- ElastiCache -> Caches
- EC2 -> Volumes and snapshots
- ECR -> Repositories
- S3 -> Buckets
- CloudWatch -> Log groups, alarms, dashboards

## 14. Final cleanup — destroy costly resources

Do cleanup while your credentials and repository state are still available.

### Step 14.1 — preserve evidence, not infrastructure

Before deletion, save:

- Screenshots of dashboard and alarms.
- Selected sanitized log snippets.
- Terraform outputs without secrets.
- A short incident/failure-test report.

Do not preserve database dumps unless needed.

### Step 14.2 — empty versioned S3 buckets if necessary

Terraform cannot delete a non-empty bucket unless `force_destroy = true` is configured.

For a dev-only export bucket, use Terraform `force_destroy = true` or empty it deliberately.

Example:

```bash
EXPORT_BUCKET=$(terraform output -raw export_bucket_name)
aws s3 rm "s3://$EXPORT_BUCKET" --recursive
```

If versioning is enabled, deleting current objects alone may not remove all versions. Use an appropriate version cleanup script or dev-only `force_destroy`.

### Step 14.3 — destroy with Terraform

```bash
terraform plan -destroy -out=destroy.tfplan
terraform apply destroy.tfplan
```

Read the destroy plan before applying.

Expected deletion includes:

- ECS services and task definitions managed by state
- ALB, listeners, and target groups
- NAT Gateway and Elastic IP
- RDS
- ElastiCache
- SQS and DLQ
- S3 bucket
- CloudWatch dashboard, alarms, and log groups
- SNS alerts topic
- Secrets
- IAM roles/policies
- Route tables, subnets, gateways, security groups, and VPC
- ECR repositories if configured for destroy

### Step 14.4 — wait for asynchronous deletions to finish

Some resources remain in `deleting` state. Verify final status before assuming cleanup is complete.

Do not stop at `terraform destroy complete` if Terraform had warnings or resources managed outside its state.

## 15. Post-destroy verification checklist

### 15.1 NAT Gateways

```bash
aws ec2 describe-nat-gateways \
  --filter Name=tag:Project,Values=cloudtask \
  --query 'NatGateways[?State!=`deleted`].[NatGatewayId,State]' \
  --output table
```

Expected: no active project NAT Gateway.

### 15.2 Elastic IPs

```bash
aws ec2 describe-addresses \
  --filters Name=tag:Project,Values=cloudtask \
  --output table
```

Expected: none.

### 15.3 Load balancers

```bash
aws elbv2 describe-load-balancers --output table
```

Manually confirm no `cloudtask` load balancer remains.

### 15.4 ECS

```bash
aws ecs list-clusters
```

Confirm no project cluster/service/tasks remain.

### 15.5 RDS

```bash
aws rds describe-db-instances \
  --query 'DBInstances[?contains(DBInstanceIdentifier, `cloudtask`)].[DBInstanceIdentifier,DBInstanceStatus]' \
  --output table
```

Also check manual and automated snapshots.

### 15.6 ElastiCache

```bash
aws elasticache describe-cache-clusters \
  --query 'CacheClusters[?contains(CacheClusterId, `cloudtask`)].[CacheClusterId,CacheClusterStatus]' \
  --output table
```

### 15.7 EBS volumes and snapshots

```bash
aws ec2 describe-volumes \
  --filters Name=tag:Project,Values=cloudtask \
  --output table

aws ec2 describe-snapshots \
  --owner-ids self \
  --filters Name=tag:Project,Values=cloudtask \
  --output table
```

### 15.8 ECR

```bash
aws ecr describe-repositories \
  --query 'repositories[?contains(repositoryName, `cloudtask`)].repositoryName' \
  --output table
```

Delete remaining repositories/images if intentionally excluded from Terraform destruction.

### 15.9 S3

```bash
aws s3api list-buckets \
  --query 'Buckets[?contains(Name, `cloudtask`)].Name' \
  --output table
```

### 15.10 CloudWatch logs

```bash
aws logs describe-log-groups \
  --log-group-name-prefix '/cloudtask/' \
  --output table
```

Delete leftovers if not intentionally retained.

### 15.11 Resource Explorer and Tag Editor

Search again:

```text
tag:Project=cloudtask
```

Remember that indexing can lag and coverage is not universal. Treat results as an additional check, not proof of zero cost.

### 15.12 Billing review

Check Billing and Cost Explorer on the following day because usage data can be delayed.

Look specifically for:

- NAT Gateway
- EC2 public IPv4
- Elastic Load Balancing
- Fargate
- RDS
- ElastiCache
- CloudWatch

## 16. Cleanup sign-off table

Fill this before ending the lab:

| Resource category | Expected after cleanup | Verified |
|---|---:|---|
| NAT Gateway | 0 | [ ] |
| Elastic IP/Public IPv4 | 0 project-owned | [ ] |
| ALB/NLB | 0 | [ ] |
| ECS running tasks | 0 | [ ] |
| RDS instances | 0 | [ ] |
| RDS manual snapshots | 0 unless intentional | [ ] |
| ElastiCache clusters | 0 | [ ] |
| EBS volumes/snapshots | 0 project-owned | [ ] |
| S3 buckets | 0 project-owned | [ ] |
| ECR repositories | 0 unless intentionally retained | [ ] |
| CloudWatch log groups | 0 unless intentionally retained | [ ] |
| SQS queues and DLQs | 0 | [ ] |
| SNS topics | 0 project-owned | [ ] |
| CloudWatch dashboards/alarms | 0 unless intentionally retained | [ ] |
| Secrets Manager secrets | 0 project-owned | [ ] |
| VPC | 0 project-owned | [ ] |
| Resource Explorer tag search | No unexpected results | [ ] |
| Billing follow-up scheduled | Yes | [ ] |

## 17. Recommended lab journal format

For every failure experiment, record:

```text
Experiment:
Date/time:
Change introduced:
Expected behavior:
Observed user symptom:
CloudWatch evidence:
ECS/ALB/SQS/RDS evidence:
Root cause:
Repair:
Time to detect:
Time to recover:
Preventive control:
```

## 18. Completion criteria

You have completed the lab when you can explain and demonstrate:

1. Why the ALB is public but ECS tasks are private.
2. Why private ECS tasks need NAT or VPC endpoints for AWS service access.
3. How route tables direct public and private traffic.
4. How security groups reference one another.
5. How ECS execution roles differ from application task roles.
6. How SQS visibility timeout, retries, idempotency, and DLQ work.
7. Why `/health` should not depend on PostgreSQL.
8. How CloudWatch exposes failure symptoms.
9. How Terraform detects and repairs manual drift.
10. How to prove that costly resources have been deleted.

