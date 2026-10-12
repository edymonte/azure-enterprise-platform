variable "subscription_id" {
  type = string
}

variable "org" {
  type    = string
  default = "mfs"
}

variable "alert_email" {
  type = string
}

variable "allowed_locations" {
  description = "brazilsouth is allowed only for the Traffic Manager DR lab."
  type        = list(string)
  default     = ["eastus2", "brazilsouth"]
}

variable "mandatory_tags" {
  type    = list(string)
  default = ["Owner", "Environment", "CostCenter"]
}

variable "guardrail_effect" {
  description = "Audit while building; Deny is applied during the governance game day."
  type        = string
  default     = "Audit"

  validation {
    condition     = contains(["Audit", "Deny", "Disabled"], var.guardrail_effect)
    error_message = "guardrail_effect must be Audit, Deny or Disabled."
  }
}

variable "aks_policy_effect" {
  type    = string
  default = "Audit"

  validation {
    condition     = contains(["Audit", "Deny", "Disabled"], var.aks_policy_effect)
    error_message = "aks_policy_effect must be Audit, Deny or Disabled."
  }
}

variable "enable_defender" {
  type    = bool
  default = true
}

variable "defender_plans" {
  type    = list(string)
  default = ["Containers", "KeyVaults", "SqlServers"]
}
