# SNS topic (subscribe manually), five alarms, and the operations dashboard.

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts"
}

resource "aws_cloudwatch_metric_alarm" "alb_target_5xx" {
  alarm_name          = "${var.name_prefix}-alb-target-5xx"
  alarm_description   = "More than 5 target 5xx responses in 5 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Requires Container Insights on the cluster (enabled in ecs-cluster module).
resource "aws_cloudwatch_metric_alarm" "api_running_tasks" {
  alarm_name          = "${var.name_prefix}-api-running-tasks"
  alarm_description   = "API service has no running tasks"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = var.api_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "queue_oldest_message" {
  alarm_name          = "${var.name_prefix}-exports-queue-lag"
  alarm_description   = "Oldest export message waiting more than 5 minutes"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.queue_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "${var.name_prefix}-exports-dlq-messages"
  alarm_description   = "Any message in the exports DLQ"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.dlq_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.name_prefix}-rds-cpu"
  alarm_description   = "RDS CPU above 80% for 10 minutes"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.db_instance_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name_prefix

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 8, height = 6
        properties = {
          title  = "ALB traffic"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix],
            [".", "HTTPCode_Target_5XX_Count", ".", "."],
            [".", "HTTPCode_Target_4XX_Count", ".", "."]
          ]
        }
      },
      {
        type = "metric", x = 8, y = 0, width = 8, height = 6
        properties = {
          title  = "ALB target response time"
          region = var.aws_region
          stat   = "p95"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix]
          ]
        }
      },
      {
        type = "metric", x = 16, y = 0, width = 8, height = 6
        properties = {
          title  = "Running tasks"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.cluster_name, "ServiceName", var.api_service_name],
            ["...", var.worker_service_name],
            ["...", var.web_service_name]
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 8, height = 6
        properties = {
          title  = "ECS CPU utilization"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", var.api_service_name],
            ["...", var.worker_service_name],
            ["...", var.web_service_name]
          ]
        }
      },
      {
        type = "metric", x = 8, y = 6, width = 8, height = 6
        properties = {
          title  = "ECS memory utilization"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", var.api_service_name],
            ["...", var.worker_service_name],
            ["...", var.web_service_name]
          ]
        }
      },
      {
        type = "metric", x = 16, y = 6, width = 8, height = 6
        properties = {
          title  = "Exports queue"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.queue_name],
            [".", "ApproximateAgeOfOldestMessage", ".", "."],
            [".", "ApproximateNumberOfMessagesVisible", ".", var.dlq_name, { label = "DLQ visible" }]
          ]
        }
      },
      {
        type = "metric", x = 0, y = 12, width = 8, height = 6
        properties = {
          title  = "RDS"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_identifier],
            [".", "DatabaseConnections", ".", "."]
          ]
        }
      },
      {
        type = "metric", x = 8, y = 12, width = 8, height = 6
        properties = {
          title  = "Redis"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ElastiCache", "CPUUtilization", "CacheClusterId", "${var.redis_replication_group_id}-001"],
            [".", "CurrConnections", ".", "."]
          ]
        }
      },
      {
        type = "metric", x = 16, y = 12, width = 8, height = 6
        properties = {
          title  = "Export processing (worker EMF)"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            [var.emf_namespace, "ExportsCompleted"],
            [".", "ExportsFailed"],
            [".", "ExportProcessingDurationMs", { stat = "Average" }]
          ]
        }
      }
    ]
  })
}
