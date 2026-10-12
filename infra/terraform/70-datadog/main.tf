# 70-datadog — monitoring-as-code in Datadog (the "market" observability stack).
#
# The Datadog Agent itself is installed in AKS by Argo CD
# (gitops/platform/datadog). This layer only manages Datadog-side objects:
# monitors, an SLO and a dashboard.
#
# Credentials come from environment variables, never from tfvars:
#   DD_API_KEY, DD_APP_KEY, DD_HOST (e.g. https://api.us5.datadoghq.com)

provider "datadog" {}

locals {
  service = "customer-portal-api"
  scope   = "service:${local.service},env:${var.dd_env}"
  notify  = join(" ", var.notify_handles)

  common_tags = [
    "team:platform",
    "project:azure-enterprise-platform",
    "env:${var.dd_env}",
    "managed-by:terraform",
  ]
}

resource "datadog_monitor" "error_rate" {
  name    = "[${var.dd_env}] Customer portal API error rate above 5%"
  type    = "query alert"
  query   = "sum(last_5m):( sum:trace.express.request.errors{${local.scope}}.as_count() / sum:trace.express.request.hits{${local.scope}}.as_count() ) > 0.05"
  message = <<-EOT
    Error ratio for {{service.name}} is {{value}}.
    Runbook: docs/game-days.md#gd-01
    ${local.notify}
  EOT

  monitor_thresholds {
    critical = 0.05
    warning  = 0.02
  }

  require_full_window = false
  notify_no_data      = false
  tags                = local.common_tags
}

resource "datadog_monitor" "latency_p95" {
  name    = "[${var.dd_env}] Customer portal API p95 latency above 500 ms"
  type    = "query alert"
  query   = "percentile(last_10m):p95:trace.express.request{${local.scope}} > 0.5"
  message = <<-EOT
    p95 latency for {{service.name}} is {{value}}s.
    Runbook: docs/game-days.md#gd-02
    ${local.notify}
  EOT

  monitor_thresholds {
    critical = 0.5
    warning  = 0.3
  }

  tags = local.common_tags
}

resource "datadog_monitor" "pod_restarts" {
  name    = "[${var.dd_env}] Customer portal pods restarting"
  type    = "query alert"
  query   = "change(max(last_15m),last_15m):sum:kubernetes_state.container.restarts{kube_namespace:portal-${var.dd_env}} by {pod_name} > 3"
  message = <<-EOT
    Pod {{pod_name.name}} restarted more than 3 times in 15 minutes.
    Check: kubectl describe pod / Datadog Live Containers.
    ${local.notify}
  EOT

  monitor_thresholds {
    critical = 3
  }

  tags = local.common_tags
}

resource "datadog_service_level_objective" "availability" {
  name        = "Customer portal API availability (${var.dd_env})"
  type        = "metric"
  description = "Share of successful requests. Error budget drives release decisions."

  query {
    numerator   = "sum:trace.express.request.hits{${local.scope}}.as_count() - sum:trace.express.request.errors{${local.scope}}.as_count()"
    denominator = "sum:trace.express.request.hits{${local.scope}}.as_count()"
  }

  thresholds {
    timeframe = "7d"
    target    = var.slo_target
    warning   = var.slo_target + 0.3
  }

  tags = local.common_tags
}

resource "datadog_dashboard_json" "portal" {
  dashboard = templatefile("${path.module}/../../../observability/dashboards/datadog-customer-portal.json.tftpl", {
    env     = var.dd_env
    service = local.service
    slo_id  = datadog_service_level_objective.availability.id
  })
}
