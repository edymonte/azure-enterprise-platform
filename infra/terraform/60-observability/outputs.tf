output "grafana_name" {
  value = azurerm_dashboard_grafana.this.name
}

output "grafana_resource_group_name" {
  value = azurerm_dashboard_grafana.this.resource_group_name
}

output "grafana_endpoint" {
  value = azurerm_dashboard_grafana.this.endpoint
}
