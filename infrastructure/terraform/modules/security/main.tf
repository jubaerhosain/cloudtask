# Security groups per spec §13. All service-to-service rules reference SGs,
# never CIDRs. Rules live in separate resources so the ALB↔api/web and
# api/worker↔rds/redis reference cycles don't trip Terraform's graph.

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Internet-facing ALB"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-alb" }
}

resource "aws_security_group" "api" {
  name        = "${var.name_prefix}-api"
  description = "API service tasks"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-api" }
}

resource "aws_security_group" "worker" {
  name        = "${var.name_prefix}-worker"
  description = "Worker service tasks"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-worker" }
}

resource "aws_security_group" "web" {
  name        = "${var.name_prefix}-web"
  description = "Web service tasks"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-web" }
}

resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds"
  description = "PostgreSQL database"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-rds" }
}

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis"
  description = "ElastiCache Redis"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-redis" }
}

# --- ALB ---

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from the internet"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to api tasks"
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_web" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to web tasks"
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

# --- API ---

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "Traffic from ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "api_to_rds" {
  security_group_id            = aws_security_group.api.id
  description                  = "PostgreSQL"
  referenced_security_group_id = aws_security_group.rds.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "api_to_redis" {
  security_group_id            = aws_security_group.api.id
  description                  = "Redis"
  referenced_security_group_id = aws_security_group.redis.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  description       = "HTTPS to AWS APIs (ECR, Secrets Manager, SQS, S3) via NAT"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# --- Worker ---

resource "aws_vpc_security_group_egress_rule" "worker_to_rds" {
  security_group_id            = aws_security_group.worker.id
  description                  = "PostgreSQL"
  referenced_security_group_id = aws_security_group.rds.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "worker_https" {
  security_group_id = aws_security_group.worker.id
  description       = "HTTPS to AWS APIs (ECR, Secrets Manager, SQS, S3) via NAT"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# --- Web ---

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  description                  = "Traffic from ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "web_https" {
  security_group_id = aws_security_group.web.id
  description       = "HTTPS to AWS APIs (ECR image pull, logs) via NAT"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# --- RDS ---

resource "aws_vpc_security_group_ingress_rule" "rds_from_api" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from api"
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_worker" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from worker"
  referenced_security_group_id = aws_security_group.worker.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# --- Redis ---

resource "aws_vpc_security_group_ingress_rule" "redis_from_api" {
  security_group_id            = aws_security_group.redis.id
  description                  = "Redis from api"
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}
