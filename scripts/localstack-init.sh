#!/usr/bin/env bash
# LocalStack init hook — runs once LocalStack is ready.
# Creates the export queue + dead-letter queue (redrive maxReceiveCount=3) and
# the export S3 bucket, mirroring the AWS resources from spec §14.
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
QUEUE_NAME="cloudtask-exports"
DLQ_NAME="cloudtask-exports-dlq"
BUCKET_NAME="cloudtask-exports-local"

echo "[localstack-init] creating DLQ ${DLQ_NAME}"
DLQ_URL=$(awslocal sqs create-queue --queue-name "${DLQ_NAME}" --region "${REGION}" \
  --query 'QueueUrl' --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "${DLQ_URL}" \
  --attribute-names QueueArn --region "${REGION}" \
  --query 'Attributes.QueueArn' --output text)

echo "[localstack-init] creating main queue ${QUEUE_NAME} with redrive to DLQ"
awslocal sqs create-queue --queue-name "${QUEUE_NAME}" --region "${REGION}" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

echo "[localstack-init] creating bucket ${BUCKET_NAME}"
awslocal s3 mb "s3://${BUCKET_NAME}" --region "${REGION}" || true

echo "[localstack-init] done"
