output "tenant_id" {
  value = data.azurerm_client_config.current.tenant_id
}

output "github_client_id" {
  description = "GitHub repo variable AZURE_CLIENT_ID."
  value       = azuread_application.github.client_id
}

output "ado_client_id" {
  description = "Paste into the Azure DevOps service connection (manual WIF mode)."
  value       = try(azuread_application.ado[0].client_id, null)
}

output "pipeline_object_ids" {
  value = local.pipelines
}

output "sql_admin_group_name" {
  value = azuread_group.sql_admins.display_name
}

output "sql_admin_group_object_id" {
  value = azuread_group.sql_admins.object_id
}
