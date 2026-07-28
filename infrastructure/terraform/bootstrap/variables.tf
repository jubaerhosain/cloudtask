variable "aws_region" {
  description = "AWS region for the state backend resources"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project name used as resource name prefix"
  type        = string
  default     = "cloudtask"
}

variable "owner" {
  description = "Owner tag applied to all resources"
  type        = string
  default     = "jubaer"
}

# The only account-specific value in this stack, supplied by the gitignored
# account.auto.tfvars. main.tf builds the deploy role ARN from it.
variable "aws_account_id" {
  description = "AWS account ID the state bucket is created in (set in account.auto.tfvars, which is gitignored)"
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits."
  }
}
