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

variable "deploy_role_arn" {
  description = "IAM role Terraform assumes for all AWS operations (trusts the owner's IAM user)"
  type        = string
}
