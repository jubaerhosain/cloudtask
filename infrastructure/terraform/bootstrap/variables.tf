variable "aws_region" {
  description = "AWS region for the state backend resources"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project name used as resource name prefix"
  type        = string
  default     = "cloudtask"
}

variable "owner" {
  description = "Owner tag applied to all resources"
  type        = string
  default     = "jubaer"
}

variable "expires_on" {
  description = "ExpiresOn tag (YYYY-MM-DD) signalling when resources should be gone"
  type        = string
}
