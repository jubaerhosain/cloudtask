variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "private_data_subnet_ids" {
  description = "Private data subnets for the cache subnet group"
  type        = list(string)
}

variable "security_group_id" {
  description = "Redis security group"
  type        = string
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}
