locals {
  # Role Terraform assumes for every AWS call (created manually in the console;
  # trust policy allows your IAM user). Composed here so the account ID is the
  # only value that has to stay out of git. The same ARN is repeated literally
  # in backend.hcl — backend blocks cannot reference variables or locals.
  deploy_role_arn = "arn:aws:iam::${var.aws_account_id}:role/${var.project_name}-terraform-deploy"
}

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
