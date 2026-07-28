variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project name (resource name prefix segment)"
  type        = string
  default     = "cloudtask"
}

variable "environment" {
  description = "Environment name (resource name prefix segment)"
  type        = string
  default     = "dev"
}

variable "owner" {
  description = "Owner tag"
  type        = string
  default     = "jubaer"
}

# The only account-specific value in this stack. Kept out of terraform.tfvars
# (which is committed) and supplied by the gitignored account.auto.tfvars so the
# rest of the environment config can live in git. providers.tf builds the deploy
# role ARN from it.
variable "aws_account_id" {
  description = "AWS account ID the stack deploys into (set in account.auto.tfvars, which is gitignored)"
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits."
  }
}

variable "enable_nat_gateway" {
  description = "Provision the NAT gateway (required for tasks to reach ECR/Secrets/SQS/S3)"
  type        = bool
  default     = true
}

variable "github_repository" {
  description = "GitHub repo allowed to assume the CI role"
  type        = string
  default     = "jubaerhosain/cloudtask"
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC provider; set false if the account already has one"
  type        = bool
  default     = true
}

# Image tags are only used for the FIRST task-definition revision. CI registers
# new revisions with real git-SHA tags on every deploy, and the ECS services
# ignore task_definition drift, so these stay at "bootstrap" forever.
variable "api_image_tag" {
  description = "API image tag for the initial task definition"
  type        = string
  default     = "bootstrap"
}

variable "worker_image_tag" {
  description = "Worker image tag for the initial task definition"
  type        = string
  default     = "bootstrap"
}

variable "web_image_tag" {
  description = "Web image tag for the initial task definition"
  type        = string
  default     = "bootstrap"
}

variable "database_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

# Services are created at 0 so nothing pulls the placeholder images; the CI
# deploy job scales to 1 on the first release run (and ECS services ignore
# desired_count drift afterwards).
variable "desired_count" {
  description = "Initial desired count per service"
  type        = number
  default     = 0
}

variable "container_port" {
  description = "Port the api/web containers listen on"
  type        = number
  default     = 3000
}

variable "log_level" {
  description = "Application log level"
  type        = string
  default     = "info"
}
