output "key_vault_id" {
  value = azurerm_key_vault.portal.id
}

output "key_vault_name" {
  value = azurerm_key_vault.portal.name
}

output "sql_server_id" {
  value = azurerm_mssql_server.portal.id
}

output "sql_server_fqdn" {
  value = azurerm_mssql_server.portal.fully_qualified_domain_name
}

output "sql_database_name" {
  value = azurerm_mssql_database.portal.name
}
