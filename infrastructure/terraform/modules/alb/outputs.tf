output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_arn_suffix" {
  description = "For CloudWatch ALB metrics dimensions"
  value       = aws_lb.this.arn_suffix
}

output "api_target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "api_target_group_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "web_target_group_arn_suffix" {
  value = aws_lb_target_group.web.arn_suffix
}
