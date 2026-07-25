variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "aws_region" {
  description = "Region (dashboard widgets)"
  type        = string
}

variable "cluster_name" {
  description = "ECS cluster name"
  type        = string
}

variable "api_service_name" {
  description = "API ECS service name"
  type        = string
}

variable "worker_service_name" {
  description = "Worker ECS service name"
  type        = string
}

variable "web_service_name" {
  description = "Web ECS service name"
  type        = string
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix for metric dimensions"
  type        = string
}

variable "queue_name" {
  description = "Exports queue name"
  type        = string
}

variable "dlq_name" {
  description = "Exports DLQ name"
  type        = string
}

variable "db_instance_identifier" {
  description = "RDS instance identifier"
  type        = string
}

variable "redis_replication_group_id" {
  description = "ElastiCache replication group id (cache cluster id is <id>-001)"
  type        = string
}

variable "emf_namespace" {
  description = "CloudWatch namespace the worker emits EMF metrics to"
  type        = string
  default     = "CloudTask/Dev"
}
