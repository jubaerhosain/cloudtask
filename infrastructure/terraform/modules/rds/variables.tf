variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "private_data_subnet_ids" {
  description = "Private data subnets for the DB subnet group"
  type        = list(string)
}

variable "security_group_id" {
  description = "RDS security group"
  type        = string
}

variable "instance_class" {
  description = "DB instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Storage in GB"
  type        = number
  default     = 20
}

variable "database_name" {
  description = "Initial database name"
  type        = string
  default     = "cloudtask"
}

variable "master_username" {
  description = "Master username"
  type        = string
  default     = "cloudtask"
}
