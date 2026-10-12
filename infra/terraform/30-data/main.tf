# 30-data — Key Vault and Azure SQL, reachable only through private endpoints.
#
# Design notes:
# - No secret VALUES are managed here: they never land in Terraform state.
#   Secrets are written by an operator/pipeline (see docs/runbook.md).
# - SQL uses Microsoft Entra-only authentication: no SQL passwords exist.

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
  }
  subscription_id = var.subscription_id
}

data "azurerm_client_config" "current" {}

locals {
  foundation = data.terraform_remote_state.foundation.outputs
  rg_name    = local.foundation.spoke_resource_group_name
  location   = local.foundation.location
  operators  = toset(concat([data.azurerm_client_config.current.object_id], var.operator_object_ids))

  tags = merge(var.tags, {
    Environment = var.environment
    Layer       = "30-data"
  })
}

# ---------------------------------------------------------------------------
# Key Vault (RBAC model, firewall + private endpoint)
# ---------------------------------------------------------------------------
resource "azurerm_key_vault" "portal" {
  name                          = "kv-${var.org}-portal-${var.name_suffix}"
  location                      = local.location
  resource_group_name           = local.rg_name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = false # lab only: allows clean destroy/recreate
  soft_delete_retention_days    = 7
  public_network_access_enabled = true # data plane still filtered by network_acls

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = local.foundation.operator_ip_ranges
  }

  tags = local.tags
}

resource "azurerm_role_assignment" "kv_operators" {
  for_each             = local.operators
  scope                = azurerm_key_vault.portal.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}

resource "azurerm_private_endpoint" "kv" {
  name                = "pe-${azurerm_key_vault.portal.name}"
  location            = local.location
  resource_group_name = local.rg_name
  subnet_id           = local.foundation.private_endpoint_subnet_id

  private_service_connection {
    name                           = "kv"
    private_connection_resource_id = azurerm_key_vault.portal.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [local.foundation.private_dns_zone_ids["privatelink.vaultcore.azure.net"]]
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Azure SQL (Entra-only auth, private endpoint, PITR backups)
# ---------------------------------------------------------------------------
resource "azurerm_mssql_server" "portal" {
  name                          = "sql-${var.org}-portal-${var.name_suffix}"
  resource_group_name           = local.rg_name
  location                      = local.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = var.sql_temporary_public_access

  azuread_administrator {
    login_username              = data.terraform_remote_state.identity.outputs.sql_admin_group_name
    object_id                   = data.terraform_remote_state.identity.outputs.sql_admin_group_object_id
    azuread_authentication_only = true
  }

  tags = local.tags
}

# Only exists while an operator needs to run the one-off GRANT script.
resource "azurerm_mssql_firewall_rule" "operator" {
  for_each         = var.sql_temporary_public_access ? toset(local.foundation.operator_ip_ranges) : toset([])
  name             = "operator-${replace(replace(each.value, ".", "-"), "/", "_")}"
  server_id        = azurerm_mssql_server.portal.id
  start_ip_address = cidrhost(each.value, 0)
  end_ip_address   = cidrhost(each.value, -1)
}

resource "azurerm_mssql_database" "portal" {
  name                 = "portal"
  server_id            = azurerm_mssql_server.portal.id
  sku_name             = var.sql_sku_name
  max_size_gb          = 2
  storage_account_type = "Local"

  short_term_retention_policy {
    retention_days = 7
  }

  tags = local.tags
}

resource "azurerm_private_endpoint" "sql" {
  name                = "pe-${azurerm_mssql_server.portal.name}"
  location            = local.location
  resource_group_name = local.rg_name
  subnet_id           = local.foundation.private_endpoint_subnet_id

  private_service_connection {
    name                           = "sql"
    private_connection_resource_id = azurerm_mssql_server.portal.id
    subresource_names              = ["sqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [local.foundation.private_dns_zone_ids["privatelink.database.windows.net"]]
  }

  tags = local.tags
}
