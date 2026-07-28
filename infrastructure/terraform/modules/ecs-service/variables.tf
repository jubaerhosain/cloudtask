variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "service_name" {
  description = "Short service name: api, worker, or web. Also the container name (contract with release.yml)"
  type        = string
}

variable "cluster_arn" {
  description = "ECS cluster ARN"
  type        = string
}

variable "image" {
  description = "Full image reference including tag (placeholder at bootstrap; CI registers real revisions later)"
  type        = string
}

variable "cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate task memory (MiB)"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Initial desired count. CI owns this after bootstrap (lifecycle ignore_changes)"
  type        = number
  default     = 0
}

variable "container_port" {
  description = "Container port; null for services without one (worker)"
  type        = number
  default     = null
}

variable "subnet_ids" {
  description = "Private app subnets for tasks"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group for tasks"
  type        = string
}

variable "execution_role_arn" {
  description = "ECS task execution role (ECR pull, logs, secrets)"
  type        = string
}

variable "task_role_arn" {
  description = "Task role for app AWS calls; null for services that make none (web)"
  type        = string
  default     = null
}

variable "environment_variables" {
  description = "Plain env vars for the container"
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secret env vars: name => Secrets Manager valueFrom reference"
  type        = map(string)
  default     = {}
}

variable "container_health_check" {
  description = <<-EOT
    Optional ECS container-level health check. Null (default) omits the block
    entirely, which is what the worker wants — it has no port to probe.
    This is independent of the ALB target group check: ECS replaces a container
    whose own check fails, whereas the ALB only stops sending it traffic.
  EOT

  type = object({
    command      = list(string)
    interval     = optional(number, 30)
    timeout      = optional(number, 5)
    retries      = optional(number, 3)
    start_period = optional(number, 30)
  })

  default = null

  validation {
    condition     = var.container_health_check == null ? true : length(var.container_health_check.command) > 0
    error_message = "container_health_check.command must be non-empty; the first element is CMD or CMD-SHELL."
  }

  validation {
    condition = var.container_health_check == null ? true : contains(
      ["CMD", "CMD-SHELL"], var.container_health_check.command[0]
    )
    error_message = "container_health_check.command must start with \"CMD\" or \"CMD-SHELL\"."
  }
}

variable "target_group_arn" {
  description = "ALB target group to register with; null for services not behind the ALB (worker)"
  type        = string
  default     = null
}

variable "aws_region" {
  description = "Region for the awslogs driver"
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention"
  type        = number
  default     = 7
}
