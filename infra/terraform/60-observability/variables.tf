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

variable "grafana_major_version" {
  type    = string
  default = "11"
}

variable "grafana_admin_object_ids" {
  type    = list(string)
  default = []
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
