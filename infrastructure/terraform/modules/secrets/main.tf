# Application secret cloudtask/dev/application holding {DATABASE_URL, JWT_SECRET}.
# ECS task definitions reference individual JSON keys via
# "<secret_arn>:KEY::" valueFrom entries — values never appear in task defs.

resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "application" {
  name = "${var.project_name}/${var.environment}/application"

  # Immediate deletion so destroy/recreate cycles don't collide with the
  # default 30-day recovery window.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "application" {
  secret_id = aws_secretsmanager_secret.application.id

  secret_string = jsonencode({
    DATABASE_URL = "postgresql://${var.database_username}:${urlencode(var.database_password)}@${var.database_host}:${var.database_port}/${var.database_name}"
    JWT_SECRET   = random_password.jwt_secret.result
  })
}
