# Single-node Redis 7. A replication group (not aws_elasticache_cluster) is
# required for in-transit encryption, which the API expects via
# REDIS_TLS_ENABLED=true. No AUTH token — the app has no auth config; access
# control is SG-only (api SG ingress).

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = var.private_data_subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "${var.name_prefix} application cache"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.node_type

  num_cache_clusters         = 1
  automatic_failover_enabled = false

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [var.security_group_id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  apply_immediately = true
}
