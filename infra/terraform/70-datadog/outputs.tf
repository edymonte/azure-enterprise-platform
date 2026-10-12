output "monitor_ids" {
  value = {
    error_rate   = datadog_monitor.error_rate.id
    latency_p95  = datadog_monitor.latency_p95.id
    pod_restarts = datadog_monitor.pod_restarts.id
  }
}

output "slo_id" {
  value = datadog_service_level_objective.availability.id
}

output "dashboard_url" {
  value = datadog_dashboard_json.portal.url
}
