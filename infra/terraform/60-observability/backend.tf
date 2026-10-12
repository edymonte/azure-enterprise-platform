# Partial backend configuration: scripts/azp.ps1 injects the storage account
# created by 00-bootstrap and a per-layer state key (one state file per layer).
terraform {
  backend "azurerm" {}
}
