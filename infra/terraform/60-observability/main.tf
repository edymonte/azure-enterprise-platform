# 60-observability — Azure Managed Grafana on top of Managed Prometheus.
# Dashboards are versioned JSON in /observability/dashboards and imported by
# scripts/grafana-import.ps1 (dashboards-as-code).

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

data "azurerm_client_config" "current" {}
data "azurerm_subscription" "current" {}

locals {
  foundation = data.terraform_remote_state.foundation.outputs
  admins     = toset(concat([data.azurerm_client_config.current.object_id], var.grafana_admin_object_ids))

  tags = merge(var.tags, {
    Environment = var.environment
    Layer       = "60-observability"
  })
}

resource "azurerm_dashboard_grafana" "this" {
  name                              = "amg-${var.org}-${var.name_suffix}"
  resource_group_name               = local.foundation.hub_resource_group_name
  location                          = local.foundation.location
  sku                               = "Standard"
  grafana_major_version             = var.grafana_major_version
  public_network_access_enabled     = true
  api_key_enabled                   = false
  deterministic_outbound_ip_enabled = false

  identity {
    type = "SystemAssigned"
  }

  azure_monitor_workspace_integrations {
    resource_id = local.foundation.monitor_workspace_id
  }

  tags = local.tags
}

# Grafana's managed identity reads metrics (Prometheus) and Azure Monitor.
resource "azurerm_role_assignment" "grafana_prometheus_reader" {
  scope                = local.foundation.monitor_workspace_id
  role_definition_name = "Monitoring Data Reader"
  principal_id         = azurerm_dashboard_grafana.this.identity[0].principal_id
}

resource "azurerm_role_assignment" "grafana_monitoring_reader" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Monitoring Reader"
  principal_id         = azurerm_dashboard_grafana.this.identity[0].principal_id
}

resource "azurerm_role_assignment" "grafana_admins" {
  for_each             = local.admins
  scope                = azurerm_dashboard_grafana.this.id
  role_definition_name = "Grafana Admin"
  principal_id         = each.value
}
