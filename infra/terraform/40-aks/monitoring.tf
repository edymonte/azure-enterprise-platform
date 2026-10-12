# Data collection for the Azure-native observability stack:
#   Container Insights  -> Log Analytics   (logs, inventory, events)
#   Managed Prometheus  -> Azure Monitor workspace (metrics, PromQL alerts)

resource "azurerm_monitor_data_collection_rule" "container_insights" {
  name                = "dcr-ci-${local.name}"
  resource_group_name = local.rg_name
  location            = local.location

  destinations {
    log_analytics {
      workspace_resource_id = local.foundation.log_analytics_workspace_id
      name                  = "ciworkspace"
    }
  }

  data_flow {
    streams      = ["Microsoft-ContainerInsights-Group-Default"]
    destinations = ["ciworkspace"]
  }

  data_sources {
    extension {
      name           = "ContainerInsightsExtension"
      extension_name = "ContainerInsights"
      streams        = ["Microsoft-ContainerInsights-Group-Default"]
      extension_json = jsonencode({
        dataCollectionSettings = {
          interval               = "1m"
          namespaceFilteringMode = "Off"
          enableContainerLogV2   = true
        }
      })
    }
  }

  tags = local.tags
}

resource "azurerm_monitor_data_collection_rule_association" "container_insights" {
  name                    = "ContainerInsightsExtension"
  target_resource_id      = azurerm_kubernetes_cluster.this.id
  data_collection_rule_id = azurerm_monitor_data_collection_rule.container_insights.id
}

resource "azurerm_monitor_data_collection_endpoint" "prometheus" {
  name                = "dce-prom-${local.name}"
  resource_group_name = local.rg_name
  location            = local.location
  kind                = "Linux"
  tags                = local.tags
}

resource "azurerm_monitor_data_collection_rule" "prometheus" {
  name                        = "dcr-prom-${local.name}"
  resource_group_name         = local.rg_name
  location                    = local.location
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.prometheus.id
  kind                        = "Linux"

  destinations {
    monitor_account {
      monitor_account_id = local.foundation.monitor_workspace_id
      name               = "MonitoringAccount1"
    }
  }

  data_flow {
    streams      = ["Microsoft-PrometheusMetrics"]
    destinations = ["MonitoringAccount1"]
  }

  data_sources {
    prometheus_forwarder {
      streams = ["Microsoft-PrometheusMetrics"]
      name    = "PrometheusDataSource"
    }
  }

  tags = local.tags
}

# The name "configurationAccessEndpoint" is required by the service.
resource "azurerm_monitor_data_collection_rule_association" "prometheus_endpoint" {
  name                        = "configurationAccessEndpoint"
  target_resource_id          = azurerm_kubernetes_cluster.this.id
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.prometheus.id
}

resource "azurerm_monitor_data_collection_rule_association" "prometheus" {
  name                    = "dcra-prom-${local.name}"
  target_resource_id      = azurerm_kubernetes_cluster.this.id
  data_collection_rule_id = azurerm_monitor_data_collection_rule.prometheus.id
}

# ---------------------------------------------------------------------------
# SLO-oriented alerts (PromQL) for the customer portal
# ---------------------------------------------------------------------------
resource "azurerm_monitor_alert_prometheus_rule_group" "portal" {
  name                = "prg-${local.name}-portal"
  location            = local.location
  resource_group_name = local.rg_name
  cluster_name        = azurerm_kubernetes_cluster.this.name
  rule_group_enabled  = true
  interval            = "PT1M"
  scopes              = [local.foundation.monitor_workspace_id, azurerm_kubernetes_cluster.this.id]

  rule {
    alert      = "PortalHighErrorRatio"
    enabled    = true
    expression = <<-EOT
      sum by (namespace) (rate(http_requests_total{namespace=~"portal-.*",status=~"5.."}[5m]))
      /
      sum by (namespace) (rate(http_requests_total{namespace=~"portal-.*"}[5m])) > 0.05
    EOT
    for        = "PT5M"
    severity   = 1

    annotations = {
      summary = "More than 5% of portal requests are failing (availability SLO burn)."
    }

    action {
      action_group_id = local.foundation.action_group_id
    }

    alert_resolution {
      auto_resolved   = true
      time_to_resolve = "PT10M"
    }
  }

  rule {
    alert      = "PortalHighLatencyP95"
    enabled    = true
    expression = <<-EOT
      histogram_quantile(0.95, sum by (le, namespace) (rate(http_request_duration_seconds_bucket{namespace=~"portal-.*"}[5m]))) > 0.5
    EOT
    for        = "PT10M"
    severity   = 2

    annotations = {
      summary = "Portal p95 latency above 500 ms (latency SLO)."
    }

    action {
      action_group_id = local.foundation.action_group_id
    }

    alert_resolution {
      auto_resolved   = true
      time_to_resolve = "PT10M"
    }
  }

  rule {
    alert      = "PortalPodRestarting"
    enabled    = true
    expression = <<-EOT
      increase(kube_pod_container_status_restarts_total{namespace=~"portal-.*"}[15m]) > 3
    EOT
    for        = "PT0M"
    severity   = 2

    annotations = {
      summary = "A portal container restarted more than 3 times in 15 minutes."
    }

    action {
      action_group_id = local.foundation.action_group_id
    }

    alert_resolution {
      auto_resolved   = true
      time_to_resolve = "PT15M"
    }
  }

  tags = local.tags
}
