variable "subscription_id" {
  type = string
}

variable "org" {
  type    = string
  default = "mfs"
}

variable "environment" {
  type    = string
  default = "lab"
}

variable "location" {
  type    = string
  default = "eastus2"
}

variable "alert_email" {
  type = string
}

variable "hub_cidr" {
  type    = string
  default = "10.50.0.0/16"
}

variable "spoke_cidr" {
  type    = string
  default = "10.60.0.0/16"
}

variable "operator_ip_ranges" {
  description = "Operator public CIDRs (e.g. home IP /32). Used for NSG, AKS API, Key Vault and SQL firewall."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.operator_ip_ranges : can(cidrnetmask(c)) && c != "0.0.0.0/0"])
    error_message = "operator_ip_ranges must be valid, restricted CIDRs (0.0.0.0/0 is not allowed)."
  }
}

variable "log_daily_quota_gb" {
  description = "Hard daily ingestion cap for Log Analytics — cost guardrail for the trial."
  type        = number
  default     = 1
}

variable "tags" {
  type = map(string)
  default = {
    Owner      = "edilson"
    CostCenter = "learning"
    Project    = "azure-enterprise-platform"
    ManagedBy  = "Terraform"
  }
}
