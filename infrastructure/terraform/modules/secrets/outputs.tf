output "secret_arn" {
  value = aws_secretsmanager_secret.application.arn
}

output "secret_name" {
  value = aws_secretsmanager_secret.application.name
}
