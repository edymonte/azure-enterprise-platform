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

variable "kubernetes_version" {
  description = "null = AKS default version for the region."
  type        = string
  default     = null
}

variable "sku_tier" {
  description = "Free for the lab; Standard is the production (SLA) choice."
  type        = string
  default     = "Free"
}

variable "system_node_vm_size" {
  type    = string
  default = "Standard_D2s_v5"
}

variable "system_node_min_count" {
  type    = number
  default = 1
}

variable "system_node_max_count" {
  description = "Trial subscriptions usually have a 4 vCPU regional quota: 2 x D2s_v5."
  type        = number
  default     = 2
}

variable "enable_user_pool" {
  description = "Dedicated 'apps' pool + system pool tainted for critical add-ons. Needs more vCPU quota."
  type        = bool
  default     = false
}

variable "user_node_vm_size" {
  type    = string
  default = "Standard_D2s_v5"
}

variable "user_node_max_count" {
  type    = number
  default = 3
}

variable "acr_sku" {
  description = "Basic for cost. Premium is required for private endpoints (see ADR-0004)."
  type        = string
  default     = "Basic"
}

variable "enable_defender_sensor" {
  description = "Deploys the Defender for Containers sensor (needs the Containers plan from 20-governance)."
  type        = bool
  default     = true
}

variable "cluster_admin_object_ids" {
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
