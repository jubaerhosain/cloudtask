variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "enable_nat_gateway" {
  description = "Provision a NAT gateway for private-app subnets (required for ECR/Secrets/SQS access from tasks)"
  type        = bool
  default     = true
}
