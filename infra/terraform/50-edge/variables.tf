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

variable "dns_zone_name" {
  type    = string
  default = "edymonte.com.br"
}

variable "dns_zone_resource_group_name" {
  type    = string
  default = "rg-mfs-dns"
}

variable "prod_host_label" {
  type    = string
  default = "portal"
}

variable "dev_host_label" {
  type    = string
  default = "portal-dev"
}

variable "dr_host_label" {
  type    = string
  default = "portal-dr"
}

variable "origin_host_override" {
  description = "Use a fixed origin instead of the AKS ingress FQDN (e.g. to test edge alone)."
  type        = string
  default     = ""
}

variable "front_door_sku" {
  type    = string
  default = "Premium_AzureFrontDoor"

  validation {
    condition     = contains(["Standard_AzureFrontDoor", "Premium_AzureFrontDoor"], var.front_door_sku)
    error_message = "front_door_sku must be Standard_AzureFrontDoor or Premium_AzureFrontDoor."
  }
}

variable "waf_mode" {
  type    = string
  default = "Detection"

  validation {
    condition     = contains(["Detection", "Prevention"], var.waf_mode)
    error_message = "waf_mode must be Detection or Prevention."
  }
}

variable "waf_rate_limit_per_minute" {
  type    = number
  default = 300
}

variable "enable_traffic_manager_lab" {
  type    = bool
  default = false
}

variable "dr_location" {
  type    = string
  default = "brazilsouth"
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
