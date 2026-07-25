resource "aws_ecs_cluster" "this" {
  name = var.name_prefix

  # Container Insights feeds the RunningTaskCount alarm in the monitoring module.
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
