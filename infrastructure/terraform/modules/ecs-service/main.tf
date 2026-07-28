# One Fargate service: log group + task definition + service.
# Contract with .github/workflows/release.yml:
#   - task definition family + service name: <name_prefix>-<service_name>
#   - container name: <service_name> (render action and run-task overrides key on it)
#   - log group: /ecs/<name_prefix>-<service_name>
# CI registers new task-definition revisions and owns desired_count, so both
# are excluded from Terraform drift via lifecycle ignore_changes.

locals {
  qualified_name = "${var.name_prefix}-${var.service_name}"
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.qualified_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.qualified_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    merge(
      {
        name      = var.service_name
        image     = var.image
        essential = true

        portMappings = var.container_port == null ? [] : [
          {
            containerPort = var.container_port
            protocol      = "tcp"
          }
        ]

        environment = [
          for k, v in var.environment_variables : { name = k, value = v }
        ]

        secrets = [
          for k, v in var.secrets : { name = k, valueFrom = v }
        ]

        logConfiguration = {
          logDriver = "awslogs"
          options = {
            "awslogs-group"         = aws_cloudwatch_log_group.this.name
            "awslogs-region"        = var.aws_region
            "awslogs-stream-prefix" = var.service_name
          }
        }
      },

      # Merged in rather than set to null: ECS treats an explicit null
      # healthCheck as a diff against the registered revision on every apply.
      var.container_health_check == null ? {} : {
        healthCheck = {
          command     = var.container_health_check.command
          interval    = var.container_health_check.interval
          timeout     = var.container_health_check.timeout
          retries     = var.container_health_check.retries
          startPeriod = var.container_health_check.start_period
        }
      }
    )
  ])
}

resource "aws_ecs_service" "this" {
  name            = local.qualified_name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [var.target_group_arn]

    content {
      target_group_arn = load_balancer.value
      container_name   = var.service_name
      container_port   = var.container_port
    }
  }

  health_check_grace_period_seconds = var.target_group_arn == null ? null : 60

  # CI (release.yml) registers new task-definition revisions on every deploy
  # and scales services up on first deploy; Terraform must never revert either.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}
