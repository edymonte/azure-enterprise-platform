output "state_resource_group_name" {
  value = azurerm_resource_group.tfstate.name
}

output "state_storage_account_name" {
  value = azurerm_storage_account.tfstate.name
}

output "state_container_name" {
  value = azurerm_storage_container.tfstate.name
}

output "dns_zone_name" {
  value = try(azurerm_dns_zone.public[0].name, "")
}

output "dns_zone_resource_group_name" {
  value = try(azurerm_resource_group.dns[0].name, "")
}

output "dns_zone_name_servers" {
  description = "Set these at Registro.br (DNS > Alterar servidores DNS)."
  value       = try(azurerm_dns_zone.public[0].name_servers, [])
}

output "name_suffix" {
  description = "Stable suffix for globally-unique names (ACR, Key Vault, SQL...) so they survive the daily down/up."
  value       = random_string.suffix.result
}
