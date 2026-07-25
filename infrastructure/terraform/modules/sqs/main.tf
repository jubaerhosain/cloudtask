resource "aws_sqs_queue" "dlq" {
  name = "${var.name_prefix}-exports-dlq"

  message_retention_seconds = 345600 # 4 days
}

resource "aws_sqs_queue" "exports" {
  name = "${var.name_prefix}-exports"

  visibility_timeout_seconds = var.visibility_timeout_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}
