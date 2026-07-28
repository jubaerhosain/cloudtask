variable "project_name" {
  description = "Project name (secret path segment)"
  type        = string
}

variable "environment" {
  description = "Environment name (secret path segment)"
  type        = string
}

variable "database_host" {
  description = "RDS address"
  type        = string
}

variable "database_port" {
  description = "RDS port"
  type        = number
}

variable "database_name" {
  description = "Database name"
  type        = string
}

variable "database_username" {
  description = "Master username"
  type        = string
}

variable "database_password" {
  description = "Master password"
  type        = string
  sensitive   = true
}
