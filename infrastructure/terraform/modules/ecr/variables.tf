variable "name_prefix" {
  description = "Resource name prefix (e.g. cloudtask-dev)"
  type        = string
}

variable "repository_names" {
  description = "Short app names; repos are created as <name_prefix>-<name>"
  type        = set(string)
  default     = ["api", "worker", "web"]
}
