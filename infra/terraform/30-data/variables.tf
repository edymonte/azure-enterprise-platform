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

variable "operator_object_ids" {
  description = "Extra Entra object IDs allowed to manage Key Vault secrets (e.g. pipeline identity)."
  type        = list(string)
  default     = []
}

variable "sql_temporary_public_access" {
  description = "true ONLY while running scripts/sql-grant-app-identity.ps1 from the operator IP."
  type        = bool
  default     = false
}

variable "sql_sku_name" {
  type    = string
  default = "Basic"
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

variable "name_suffix" {
  description = "Stable suffix from 00-bootstrap (common.tfvars.json) — keeps ACR/KV/SQL names identical across daily rebuilds."
  type        = string
}
