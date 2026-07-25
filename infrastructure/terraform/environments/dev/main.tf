locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Namespace the worker's EMF metrics land in (metrics.service.ts).
  emf_namespace = "CloudTask/Dev"
}

module "networking" {
  source = "../../modules/networking"

  name_prefix        = local.name_prefix
  enable_nat_gateway = var.enable_nat_gateway
}

module "security" {
  source = "../../modules/security"

  name_prefix    = local.name_prefix
  vpc_id         = module.networking.vpc_id
  container_port = var.container_port
}

module "ecr" {
  source = "../../modules/ecr"

  name_prefix = local.name_prefix
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"

  name_prefix = local.name_prefix
}

module "alb" {
  source = "../../modules/alb"

  name_prefix       = local.name_prefix
  vpc_id            = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
  security_group_id = module.security.alb_security_group_id
  container_port    = var.container_port
}

module "rds" {
  source = "../../modules/rds"

  name_prefix             = local.name_prefix
  private_data_subnet_ids = module.networking.private_data_subnet_ids
  security_group_id       = module.security.rds_security_group_id
  instance_class          = var.database_instance_class
}

module "redis" {
  source = "../../modules/redis"

  name_prefix             = local.name_prefix
  private_data_subnet_ids = module.networking.private_data_subnet_ids
  security_group_id       = module.security.redis_security_group_id
  node_type               = var.redis_node_type
}

module "sqs" {
  source = "../../modules/sqs"

  name_prefix = local.name_prefix
}

module "s3" {
  source = "../../modules/s3"

  name_prefix = local.name_prefix
}

module "secrets" {
  source = "../../modules/secrets"

  project_name      = var.project_name
  environment       = var.environment
  database_host     = module.rds.address
  database_port     = module.rds.port
  database_name     = module.rds.database_name
  database_username = module.rds.master_username
  database_password = module.rds.master_password
}

module "api_service" {
  source = "../../modules/ecs-service"

  name_prefix        = local.name_prefix
  service_name       = "api"
  cluster_arn        = module.ecs_cluster.cluster_arn
  image              = "${module.ecr.repository_urls["api"]}:${var.api_image_tag}"
  desired_count      = var.desired_count
  container_port     = var.container_port
  subnet_ids         = module.networking.private_app_subnet_ids
  security_group_id  = module.security.api_security_group_id
  execution_role_arn = aws_iam_role.ecs_execution.arn
  task_role_arn      = aws_iam_role.api_task.arn
  target_group_arn   = module.alb.api_target_group_arn
  aws_region         = var.aws_region

  environment_variables = {
    NODE_ENV                 = "production"
    PORT                     = tostring(var.container_port)
    REDIS_HOST               = module.redis.primary_endpoint_address
    REDIS_PORT               = tostring(module.redis.port)
    REDIS_TLS_ENABLED        = "true"
    AWS_REGION               = var.aws_region
    EXPORT_QUEUE_URL         = module.sqs.queue_url
    EXPORT_BUCKET_NAME       = module.s3.bucket_name
    LOG_LEVEL                = var.log_level
    ENABLE_FAILURE_ENDPOINTS = "false"
  }

  secrets = {
    DATABASE_URL = "${module.secrets.secret_arn}:DATABASE_URL::"
    JWT_SECRET   = "${module.secrets.secret_arn}:JWT_SECRET::"
  }
}

module "worker_service" {
  source = "../../modules/ecs-service"

  name_prefix        = local.name_prefix
  service_name       = "worker"
  cluster_arn        = module.ecs_cluster.cluster_arn
  image              = "${module.ecr.repository_urls["worker"]}:${var.worker_image_tag}"
  desired_count      = var.desired_count
  subnet_ids         = module.networking.private_app_subnet_ids
  security_group_id  = module.security.worker_security_group_id
  execution_role_arn = aws_iam_role.ecs_execution.arn
  task_role_arn      = aws_iam_role.worker_task.arn
  aws_region         = var.aws_region

  environment_variables = {
    NODE_ENV                       = "production"
    AWS_REGION                     = var.aws_region
    EXPORT_QUEUE_URL               = module.sqs.queue_url
    EXPORT_BUCKET_NAME             = module.s3.bucket_name
    SQS_WAIT_TIME_SECONDS          = "20"
    SQS_VISIBILITY_TIMEOUT_SECONDS = "60"
    LOG_LEVEL                      = var.log_level
  }

  secrets = {
    DATABASE_URL = "${module.secrets.secret_arn}:DATABASE_URL::"
  }
}

module "web_service" {
  source = "../../modules/ecs-service"

  name_prefix        = local.name_prefix
  service_name       = "web"
  cluster_arn        = module.ecs_cluster.cluster_arn
  image              = "${module.ecr.repository_urls["web"]}:${var.web_image_tag}"
  desired_count      = var.desired_count
  container_port     = var.container_port
  subnet_ids         = module.networking.private_app_subnet_ids
  security_group_id  = module.security.web_security_group_id
  execution_role_arn = aws_iam_role.ecs_execution.arn
  target_group_arn   = module.alb.web_target_group_arn
  aws_region         = var.aws_region

  # NEXT_PUBLIC_API_BASE_URL is baked into the image at build time.
  environment_variables = {
    NODE_ENV = "production"
    PORT     = tostring(var.container_port)
  }
}

module "monitoring" {
  source = "../../modules/monitoring"

  name_prefix                = local.name_prefix
  aws_region                 = var.aws_region
  cluster_name               = module.ecs_cluster.cluster_name
  api_service_name           = module.api_service.service_name
  worker_service_name        = module.worker_service.service_name
  web_service_name           = module.web_service.service_name
  alb_arn_suffix             = module.alb.alb_arn_suffix
  queue_name                 = module.sqs.queue_name
  dlq_name                   = module.sqs.dlq_name
  db_instance_identifier     = "${local.name_prefix}-postgres"
  redis_replication_group_id = "${local.name_prefix}-redis"
  emf_namespace              = local.emf_namespace
}

module "github_oidc" {
  source = "../../modules/github-oidc"

  name_prefix          = local.name_prefix
  github_repository    = var.github_repository
  create_oidc_provider = var.create_oidc_provider
  ecr_repository_arns  = values(module.ecr.repository_arns)
  cluster_arn          = module.ecs_cluster.cluster_arn

  service_arns = [
    module.api_service.service_arn,
    module.worker_service.service_arn,
    module.web_service.service_arn,
  ]

  api_task_definition_family = module.api_service.task_definition_family

  passable_role_arns = [
    aws_iam_role.ecs_execution.arn,
    aws_iam_role.api_task.arn,
    aws_iam_role.worker_task.arn,
  ]

  log_group_prefix_arn = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}*"
}
