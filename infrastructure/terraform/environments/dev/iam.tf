# ECS execution role + per-service task roles (spec §15, least privilege).
# Lives at the environment level because the policies reference ARNs from
# several modules.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- Execution role: image pull, logs, secret injection ---

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name_prefix}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "ecs_execution" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = values(module.ecr.repository_arns)
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "${module.api_service.log_group_arn}:*",
      "${module.worker_service.log_group_arn}:*",
      "${module.web_service.log_group_arn}:*",
    ]
  }

  statement {
    sid       = "SecretInjection"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [module.secrets.secret_arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution" {
  name   = "execution"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution.json
}

# --- API task role: enqueue exports, presign downloads ---

resource "aws_iam_role" "api_task" {
  name               = "${local.name_prefix}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "api_task" {
  statement {
    sid       = "EnqueueExports"
    actions   = ["sqs:SendMessage"]
    resources = [module.sqs.queue_arn]
  }

  statement {
    sid       = "PresignExportDownloads"
    actions   = ["s3:GetObject"]
    resources = ["${module.s3.bucket_arn}/*"]
  }

  statement {
    sid       = "Metrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.emf_namespace]
    }
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "api-task"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task.json
}

# --- Worker task role: consume exports, write results ---

resource "aws_iam_role" "worker_task" {
  name               = "${local.name_prefix}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "worker_task" {
  statement {
    sid = "ConsumeExports"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
    ]
    resources = [module.sqs.queue_arn]
  }

  statement {
    sid = "WriteExportResults"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
    ]
    resources = ["${module.s3.bucket_arn}/*"]
  }

  statement {
    sid       = "Metrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.emf_namespace]
    }
  }
}

resource "aws_iam_role_policy" "worker_task" {
  name   = "worker-task"
  role   = aws_iam_role.worker_task.id
  policy = data.aws_iam_policy_document.worker_task.json
}
