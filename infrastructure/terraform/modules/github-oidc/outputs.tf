output "ci_role_arn" {
  description = "Role ARN for the GitHub repo variable AWS_ROLE_ARN"
  value       = aws_iam_role.ci.arn
}
