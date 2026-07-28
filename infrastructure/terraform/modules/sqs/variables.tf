variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "Main queue visibility timeout; must match the worker's SQS_VISIBILITY_TIMEOUT_SECONDS"
  type        = number
  default     = 60
}

variable "max_receive_count" {
  description = "Receives before a message moves to the DLQ"
  type        = number
  default     = 3
}
