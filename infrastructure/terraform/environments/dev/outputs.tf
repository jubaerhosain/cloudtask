output "application_url" {
  description = "The app entry point"
  value       = "http://${module.alb.alb_dns_name}"
}

output "alb_dns_name" {
  description = "ALB DNS name (NEXT_PUBLIC_API_BASE_URL = http://<this>/api/v1)"
  value       = module.alb.alb_dns_name
}

output "ecr_repository_urls" {
  description = "Map of app name to ECR repository URL"
  value       = module.ecr.repository_urls
}

output "ecs_cluster_name" {
  value = module.ecs_cluster.cluster_name
}

output "ecs_service_names" {
  value = {
    api    = module.api_service.service_name
    worker = module.worker_service.service_name
    web    = module.web_service.service_name
  }
}

output "rds_endpoint" {
  value     = module.rds.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value = module.redis.primary_endpoint_address
}

output "export_queue_url" {
  value = module.sqs.queue_url
}

output "export_dlq_url" {
  value = module.sqs.dlq_url
}

output "export_bucket_name" {
  value = module.s3.bucket_name
}

output "dashboard_name" {
  value = module.monitoring.dashboard_name
}

output "sns_topic_arn" {
  description = "Subscribe an email to receive alarm notifications"
  value       = module.monitoring.sns_topic_arn
}

output "nat_gateway_id" {
  value = module.networking.nat_gateway_id
}

output "github_ci_role_arn" {
  description = "Set as GitHub repo variable AWS_ROLE_ARN"
  value       = module.github_oidc.ci_role_arn
}

output "private_app_subnet_ids" {
  description = "Where CI's migration run-task executes"
  value       = module.networking.private_app_subnet_ids
}

output "api_security_group_id" {
  description = "SG for the migration run-task"
  value       = module.security.api_security_group_id
}
