variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "github_repository" {
  description = "GitHub repo allowed to assume the CI role, e.g. jubaerhosain/cloudtask"
  type        = string
}

variable "allowed_ref" {
  description = "Git ref allowed to assume the role"
  type        = string
  default     = "refs/heads/main"
}

variable "create_oidc_provider" {
  description = "Create the account-level GitHub OIDC provider; set false if the account already has one"
  type        = bool
  default     = true
}

variable "ecr_repository_arns" {
  description = "ECR repo ARNs CI may push to"
  type        = list(string)
}

variable "cluster_arn" {
  description = "ECS cluster ARN"
  type        = string
}

variable "service_arns" {
  description = "ECS service ARNs CI may deploy to"
  type        = list(string)
}

variable "api_task_definition_family" {
  description = "API task definition family (migration run-task)"
  type        = string
}

variable "passable_role_arns" {
  description = "Execution + task role ARNs CI may pass to ECS"
  type        = list(string)
}

variable "log_group_prefix_arn" {
  description = "ARN prefix for /ecs/<name_prefix>* log groups (migration log tailing)"
  type        = string
}
