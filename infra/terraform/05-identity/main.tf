# 05-identity — WHO may change the platform.
#
# Creates, with Terraform instead of portal clicks:
#   1. One Entra application per CI/CD platform (GitHub Actions, Azure DevOps)
#      with FEDERATED credentials (OIDC) — no client secrets exist.
#   2. Azure RBAC for those identities (least privilege, subscription scope).
#   3. The Entra group that administers Azure SQL (you + the pipelines).

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

provider "azuread" {}

data "azurerm_client_config" "current" {}
data "azurerm_subscription" "current" {}

data "azurerm_storage_account" "tfstate" {
  name                = var.state_storage_account_name
  resource_group_name = var.state_resource_group_name
}

locals {
  # Roles a Terraform pipeline needs for THIS platform:
  #  - Contributor                          create/delete resources
  #  - Role Based Access Control Administrator  role assignments (AcrPull, KV, ...)
  #  - Resource Policy Contributor          policy definitions/assignments (20-governance)
  #  - Security Admin                       Defender plans (20-governance)
  pipeline_roles = [
    "Contributor",
    "Role Based Access Control Administrator",
    "Resource Policy Contributor",
    "Security Admin",
  ]

  github_subjects = {
    pull-request = "repo:${var.github_repository}:pull_request"
    main-branch  = "repo:${var.github_repository}:ref:refs/heads/main"
    env-lab      = "repo:${var.github_repository}:environment:lab"
  }

  pipelines = merge(
    { github = azuread_service_principal.github.object_id },
    var.ado_federated_subject != "" ? { ado = azuread_service_principal.ado[0].object_id } : {},
  )

  pipeline_role_pairs = {
    for pair in setproduct(keys(local.pipelines), local.pipeline_roles) :
    "${pair[0]}|${pair[1]}" => { principal = local.pipelines[pair[0]], role = pair[1] }
  }
}

# ---------------------------------------------------------------------------
# GitHub Actions identity (OIDC: token.actions.githubusercontent.com)
# ---------------------------------------------------------------------------
resource "azuread_application" "github" {
  display_name = "app-${var.org}-github-actions"
  owners       = [data.azurerm_client_config.current.object_id]
}

resource "azuread_service_principal" "github" {
  client_id = azuread_application.github.client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

resource "azuread_application_federated_identity_credential" "github" {
  for_each       = local.github_subjects
  application_id = azuread_application.github.id
  display_name   = "github-${each.key}"
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = each.value
  audiences      = ["api://AzureADTokenExchange"]
}

# ---------------------------------------------------------------------------
# Azure DevOps identity (workload identity federation, Entra issuer).
# Create the service connection in MANUAL mode first: ADO shows the issuer
# and subject to paste into ado_federated_issuer / ado_federated_subject.
# ---------------------------------------------------------------------------
resource "azuread_application" "ado" {
  count        = var.ado_federated_subject != "" ? 1 : 0
  display_name = "app-${var.org}-azure-devops"
  owners       = [data.azurerm_client_config.current.object_id]
}

resource "azuread_service_principal" "ado" {
  count     = var.ado_federated_subject != "" ? 1 : 0
  client_id = azuread_application.ado[0].client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

resource "azuread_application_federated_identity_credential" "ado" {
  count          = var.ado_federated_subject != "" ? 1 : 0
  application_id = azuread_application.ado[0].id
  display_name   = "ado-service-connection"
  issuer         = var.ado_federated_issuer
  subject        = var.ado_federated_subject
  audiences      = ["api://AzureADTokenExchange"]
}

# ---------------------------------------------------------------------------
# Azure RBAC for the pipelines
# ---------------------------------------------------------------------------
resource "azurerm_role_assignment" "pipelines" {
  for_each             = local.pipeline_role_pairs
  scope                = data.azurerm_subscription.current.id
  role_definition_name = each.value.role
  principal_id         = each.value.principal
}

resource "azurerm_role_assignment" "pipelines_state" {
  for_each             = local.pipelines
  scope                = data.azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}

# ---------------------------------------------------------------------------
# SQL administrators (Entra-only authentication on Azure SQL)
# ---------------------------------------------------------------------------
resource "azuread_group" "sql_admins" {
  display_name     = "grp-${var.org}-sql-admins"
  security_enabled = true
  owners           = [data.azurerm_client_config.current.object_id]
  members          = concat([data.azurerm_client_config.current.object_id], values(local.pipelines))
}
