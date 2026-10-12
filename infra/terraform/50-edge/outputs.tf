output "front_door_endpoint_host" {
  value = azurerm_cdn_frontdoor_endpoint.portal.host_name
}

output "front_door_profile_resource_guid" {
  description = "Value of the X-Azure-FDID header (used to lock the origin to THIS Front Door)."
  value       = azurerm_cdn_frontdoor_profile.this.resource_guid
}

output "portal_urls" {
  value = { for k, h in local.hosts : k => "https://${h}.${var.dns_zone_name}" }
}

output "traffic_manager_fqdn" {
  value = try(azurerm_traffic_manager_profile.dr[0].fqdn, null)
}

output "dr_url" {
  value = var.enable_traffic_manager_lab ? "http://${var.dr_host_label}.${var.dns_zone_name}" : null
}
