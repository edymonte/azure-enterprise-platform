variable "dd_env" {
  description = "Datadog env tag (matches DD_ENV in the Helm values): dev or prod."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "prod"], var.dd_env)
    error_message = "dd_env must be dev or prod."
  }
}

variable "notify_handles" {
  description = "Datadog notification handles, e.g. [\"@you@example.com\"]."
  type        = list(string)
  default     = []
}

variable "slo_target" {
  type    = number
  default = 99.5
}
