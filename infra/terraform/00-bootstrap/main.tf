# 00-bootstrap — long-lived resources that survive the daily destroy cycle.
#
# Uses LOCAL state on purpose (chicken-and-egg: it creates the remote state
# storage). Run once at the beginning of the lab; destroy only at the very end.

provider "azurerm" {
  features {}
  subscription_id     = var.subscription_id
  storage_use_azuread = true
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  tags = merge(var.tags, {
    Environment = "shared"
    Layer       = "00-bootstrap"
  })

  state_operators = toset(concat([data.azurerm_client_config.current.object_id], var.state_operator_object_ids))
}

# ---------------------------------------------------------------------------
# Terraform remote state (one blob per layer, Entra ID auth, no access keys)
# ---------------------------------------------------------------------------
resource "azurerm_resource_group" "tfstate" {
  name     = "rg-${var.org}-tfstate"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "tfstate" {
  name                            = "st${var.org}tfstate${random_string.suffix.result}"
  resource_group_name             = azurerm_resource_group.tfstate.name
  location                        = azurerm_resource_group.tfstate.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  allow_nested_items_to_be_public = false

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }
  }

  tags = local.tags
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "state_operator" {
  for_each             = local.state_operators
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}

# ---------------------------------------------------------------------------
# Public DNS zone — long-lived because Registro.br points to its name servers.
# Recreating the zone can change the NS set and break the delegation.
# ---------------------------------------------------------------------------
resource "azurerm_resource_group" "dns" {
  count    = var.public_dns_zone_name == "" ? 0 : 1
  name     = "rg-${var.org}-dns"
  location = var.location
  tags     = local.tags
}

resource "azurerm_dns_zone" "public" {
  count               = var.public_dns_zone_name == "" ? 0 : 1
  name                = var.public_dns_zone_name
  resource_group_name = azurerm_resource_group.dns[0].name
  tags                = local.tags
}

# ---------------------------------------------------------------------------
# Cost guardrail — the first control a real platform team puts in place.
# ---------------------------------------------------------------------------
resource "azurerm_consumption_budget_subscription" "lab" {
  count           = var.enable_budget ? 1 : 0
  name            = "budget-${var.org}-azure-lab"
  subscription_id = "/subscriptions/${var.subscription_id}"
  amount          = var.monthly_budget_amount
  time_grain      = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.alert_email]
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.alert_email]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = [var.alert_email]
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}
