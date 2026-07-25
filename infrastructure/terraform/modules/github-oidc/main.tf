# GitHub Actions OIDC federation + the CI role release.yml assumes.
# Deliberately deploy-scoped: ECR push + ECS deploy/run-task only. Terraform
# apply runs locally with operator credentials, never with this role.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "tls_certificate" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github[0].certificates[0].sha1_fingerprint]
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:${var.allowed_ref}"]
    }
  }
}

resource "aws_iam_role" "ci" {
  name               = "${var.name_prefix}-github-ci"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "ecr_push" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = var.ecr_repository_arns
  }
}

data "aws_iam_policy_document" "ecs_deploy" {
  # These two APIs have no resource-level support.
  statement {
    sid = "TaskDefinitions"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid = "Services"
    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    resources = var.service_arns
  }

  statement {
    sid     = "MigrationRunTask"
    actions = ["ecs:RunTask"]
    resources = [
      "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/${var.api_task_definition_family}:*"
    ]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }

  statement {
    sid     = "MigrationTaskPolling"
    actions = ["ecs:DescribeTasks"]
    resources = [
      "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/${var.name_prefix}/*"
    ]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }

  statement {
    sid       = "PassRolesToEcs"
    actions   = ["iam:PassRole"]
    resources = var.passable_role_arns

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid = "MigrationLogs"
    actions = [
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
    ]
    resources = [
      var.log_group_prefix_arn,
      "${var.log_group_prefix_arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "ecr_push" {
  name   = "ecr-push"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ecr_push.json
}

resource "aws_iam_role_policy" "ecs_deploy" {
  name   = "ecs-deploy"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ecs_deploy.json
}
