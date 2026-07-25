variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "vpc_id" {
  description = "VPC the security groups belong to"
  type        = string
}

variable "container_port" {
  description = "Port the api/web containers listen on"
  type        = number
  default     = 3000
}
