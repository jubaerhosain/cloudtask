# Single-AZ Postgres 16 on the smallest instance class; lab-friendly destroy
# settings (no deletion protection, no final snapshot).

resource "random_password" "master" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.private_data_subnet_ids
}

# PG16's default parameter group sets rds.force_ssl=1, but the app's TypeORM
# data source configures no TLS option — connections would be rejected.
# Disabling force_ssl needs zero app changes; traffic never leaves the
# private-data subnets. (Recorded in DEVIATIONS.md.)
resource "aws_db_parameter_group" "this" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }
}

resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.database_name
  username = var.master_username
  password = random_password.master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1

  deletion_protection = false
  skip_final_snapshot = true
  apply_immediately   = true
}
