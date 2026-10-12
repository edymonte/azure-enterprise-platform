output "location" {
  value = var.location
}

output "hub_resource_group_name" {
  value = azurerm_resource_group.hub.name
}

output "spoke_resource_group_name" {
  value = azurerm_resource_group.spoke.name
}

output "spoke_resource_group_id" {
  value = azurerm_resource_group.spoke.id
}

output "aks_subnet_id" {
  value = azurerm_subnet.aks.id
}

output "private_endpoint_subnet_id" {
  value = azurerm_subnet.private_endpoints.id
}

output "private_dns_zone_ids" {
  value = { for k, z in azurerm_private_dns_zone.this : k => z.id }
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}

output "monitor_workspace_id" {
  value = azurerm_monitor_workspace.prometheus.id
}

output "action_group_id" {
  value = azurerm_monitor_action_group.platform.id
}

output "operator_ip_ranges" {
  value = var.operator_ip_ranges
}
