variable "subscription_id" {
  type = string
}

variable "org" {
  type    = string
  default = "mfs"
}

variable "state_resource_group_name" {
  type = string
}

variable "state_storage_account_name" {
  type = string
}

variable "github_repository" {
  description = "owner/repo that is allowed to federate."
  type        = string
  default     = "edymonte/azure-enterprise-platform"
}

variable "ado_federated_issuer" {
  description = "Issuer shown by the Azure DevOps service connection (manual WIF mode)."
  type        = string
  default     = ""
}

variable "ado_federated_subject" {
  description = "Subject shown by the Azure DevOps service connection. Empty = no ADO identity yet."
  type        = string
  default     = ""
}
