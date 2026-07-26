provider "aws" {
  region = var.aws_region

  assume_role {
    role_arn     = var.deploy_role_arn
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
