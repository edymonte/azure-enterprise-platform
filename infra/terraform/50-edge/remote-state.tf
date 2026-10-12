# Upstream layer outputs (layered state: each layer owns its blob).

data "terraform_remote_state" "aks" {
  backend = "azurerm"
  config = {
    subscription_id      = var.subscription_id
    resource_group_name  = var.state_resource_group_name
    storage_account_name = var.state_storage_account_name
    container_name       = "tfstate"
    key                  = "40-aks.tfstate"
    use_azuread_auth     = true
  }
}

variable "state_resource_group_name" {
  description = "Output of 00-bootstrap (written to .runtime/azure-enterprise/common.tfvars.json)."
  type        = string
}

variable "state_storage_account_name" {
  type = string
}
