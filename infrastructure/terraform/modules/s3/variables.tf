variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "expiry_days" {
  description = "Days before export objects are expired"
  type        = number
  default     = 7
}
