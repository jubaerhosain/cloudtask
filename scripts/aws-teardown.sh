#!/usr/bin/env bash
# Tear down the CloudTask dev environment and verify nothing is left billing.
#
# Usage:
#   scripts/aws-teardown.sh                  # destroy dev env (interactive approve), then verify
#   scripts/aws-teardown.sh --auto-approve   # skip terraform's confirmation prompt
#   scripts/aws-teardown.sh --verify-only    # skip destroy, run only the leftover checks
#   scripts/aws-teardown.sh --with-bootstrap # ALSO destroy the state bucket + lock table (last!)
#
# The verification mirrors the 12-point post-destroy checklist in
# aws-deployment-lab-runbook-terraform.md §15.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="$REPO_ROOT/infrastructure/terraform/environments/dev"
BOOTSTRAP_DIR="$REPO_ROOT/infrastructure/terraform/bootstrap"

NAME_PREFIX="cloudtask-dev"
VPC_CIDR="10.20.0.0/16"
REGION="${AWS_REGION:-ap-south-1}"

AUTO_APPROVE=""
VERIFY_ONLY=false
WITH_BOOTSTRAP=false

for arg in "$@"; do
  case "$arg" in
    --auto-approve) AUTO_APPROVE="-auto-approve" ;;
    --verify-only) VERIFY_ONLY=true ;;
    --with-bootstrap) WITH_BOOTSTRAP=true ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

if ! $VERIFY_ONLY; then
  echo "==> Destroying dev environment ($DEV_DIR)"
  terraform -chdir="$DEV_DIR" destroy $AUTO_APPROVE
  echo "==> terraform destroy finished; verifying leftovers"
fi

FAILURES=0

check() {
  local label="$1" result="$2"
  # Treat empty output, "None" and "[]" as clean.
  if [ -z "$result" ] || [ "$result" = "None" ] || [ "$result" = "[]" ]; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n      leftover: %s\n' "$label" "$result"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "==> Post-destroy verification (region $REGION)"

check "1/12 NAT gateways" "$(aws ec2 describe-nat-gateways --region "$REGION" \
  --filter "Name=tag:Project,Values=cloudtask" \
  --query "NatGateways[?State!='deleted'].NatGatewayId" --output text)"

check "2/12 Elastic IPs (unassociated)" "$(aws ec2 describe-addresses --region "$REGION" \
  --query "Addresses[?AssociationId==null].AllocationId" --output text)"

check "3/12 Load balancers" "$(aws elbv2 describe-load-balancers --region "$REGION" \
  --query "LoadBalancers[?contains(LoadBalancerName, '$NAME_PREFIX')].LoadBalancerArn" --output text)"

check "4/12 ECS clusters" "$(aws ecs list-clusters --region "$REGION" \
  --query "clusterArns[?contains(@, '$NAME_PREFIX')]" --output text)"

check "5/12 RDS instances" "$(aws rds describe-db-instances --region "$REGION" \
  --query "DBInstances[?contains(DBInstanceIdentifier, '$NAME_PREFIX')].DBInstanceIdentifier" --output text)"

check "6/12 ElastiCache replication groups" "$(aws elasticache describe-replication-groups --region "$REGION" \
  --query "ReplicationGroups[?contains(ReplicationGroupId, '$NAME_PREFIX')].ReplicationGroupId" --output text)"

check "7/12 SQS queues" "$(aws sqs list-queues --region "$REGION" \
  --queue-name-prefix "$NAME_PREFIX" --query "QueueUrls" --output text)"

check "8/12 S3 buckets" "$(aws s3api list-buckets \
  --query "Buckets[?starts_with(Name, '$NAME_PREFIX')].Name" --output text)"

check "9/12 ECR repositories" "$(aws ecr describe-repositories --region "$REGION" \
  --query "repositories[?contains(repositoryName, '$NAME_PREFIX')].repositoryName" --output text 2>/dev/null || true)"

check "10/12 CloudWatch log groups" "$(aws logs describe-log-groups --region "$REGION" \
  --log-group-name-prefix "/ecs/$NAME_PREFIX" --query "logGroups[].logGroupName" --output text)"

check "11/12 Secrets (incl. scheduled deletion)" "$(aws secretsmanager list-secrets --region "$REGION" \
  --include-planned-deletion \
  --query "SecretList[?starts_with(Name, 'cloudtask/')].Name" --output text)"

check "12/12 Stray ENIs in $VPC_CIDR" "$(aws ec2 describe-network-interfaces --region "$REGION" \
  --filters "Name=addresses.private-ip-address,Values=10.20.*" \
  --query "NetworkInterfaces[].NetworkInterfaceId" --output text)"

echo

if $WITH_BOOTSTRAP; then
  echo "==> Destroying bootstrap (state bucket + lock table)"
  echo "    WARNING: this deletes the Terraform state history for the dev environment."
  terraform -chdir="$BOOTSTRAP_DIR" destroy $AUTO_APPROVE
fi

cat <<'EOF'
Reminders:
  - Unset the GitHub repo variables so the Release workflow goes dormant:
      gh variable delete AWS_ROLE_ARN
      gh variable delete AWS_REGION
      gh variable delete NEXT_PUBLIC_API_BASE_URL
  - If you recreate the environment later, the ALB DNS name CHANGES:
    update NEXT_PUBLIC_API_BASE_URL and rebuild the web image before use.
  - Double-check the bill: Billing console -> Bills -> region ap-south-1.
EOF

if [ "$FAILURES" -gt 0 ]; then
  echo "RESULT: $FAILURES check(s) found leftovers — investigate before assuming \$0." >&2
  exit 1
fi

echo "RESULT: all checks clean."
