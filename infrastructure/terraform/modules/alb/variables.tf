variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "vpc_id" {
  description = "VPC for the target groups"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for the ALB"
  type        = list(string)
}

variable "security_group_id" {
  description = "ALB security group"
  type        = string
}

variable "container_port" {
  description = "Port the api/web containers listen on"
  type        = number
  default     = 3000
}
