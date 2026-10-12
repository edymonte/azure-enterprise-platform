variable "subscription_id" {
  description = "Azure subscription used by the lab (the 30-day trial)."
  type        = string
}

variable "org" {
  description = "Short organization code used in every resource name (Monteiro Financial Services)."
  type        = string
  default     = "mfs"

  validation {
    condition     = can(regex("^[a-z0-9]{2,5}$", var.org))
    error_message = "org must be 2-5 lowercase alphanumeric characters."
  }
}

variable "location" {
  type    = string
  default = "eastus2"
}

variable "alert_email" {
  description = "E-mail that receives budget and platform alerts."
  type        = string
}

variable "public_dns_zone_name" {
  description = "Public DNS zone delegated from Registro.br. Empty string skips the zone."
  type        = string
  default     = "edymonte.com.br"
}

variable "enable_budget" {
  type    = bool
  default = true
}

variable "monthly_budget_amount" {
  description = "Budget amount in the subscription BILLING currency (check if it is USD or BRL)."
  type        = number
  default     = 150
}

variable "budget_start_date" {
  description = "First day of the current month, RFC3339."
  type        = string
  default     = "2026-10-01T00:00:00Z"
}

variable "state_operator_object_ids" {
  description = "Extra Entra object IDs (e.g. pipeline identities) that read/write Terraform state."
  type        = list(string)
  default     = []
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
