output "resource_group_name" {
  value = local.rg_name
}

output "cluster_name" {
  value = azurerm_kubernetes_cluster.this.name
}

output "acr_name" {
  value = azurerm_container_registry.this.name
}

output "acr_login_server" {
  value = azurerm_container_registry.this.login_server
}

output "oidc_issuer_url" {
  value = azurerm_kubernetes_cluster.this.oidc_issuer_url
}

output "portal_api_client_id" {
  description = "Goes into gitops/envs/*/values.yaml (workloadIdentity.clientId)."
  value       = azurerm_user_assigned_identity.portal_api.client_id
}

output "portal_api_identity_name" {
  description = "Name used in the SQL 'CREATE USER ... FROM EXTERNAL PROVIDER' statement."
  value       = azurerm_user_assigned_identity.portal_api.name
}

output "tenant_id" {
  value = data.azurerm_client_config.current.tenant_id
}

output "key_vault_name" {
  value = local.data_layer.key_vault_name
}

output "sql_server_fqdn" {
  value = local.data_layer.sql_server_fqdn
}

output "ingress_public_ip_name" {
  value = azurerm_public_ip.ingress.name
}

output "ingress_public_ip_address" {
  value = azurerm_public_ip.ingress.ip_address
}

output "ingress_fqdn" {
  description = "Front Door origin host name."
  value       = azurerm_public_ip.ingress.fqdn
}
