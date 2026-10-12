output "platform_guardrails_assignment_id" {
  value = azurerm_subscription_policy_assignment.platform_guardrails.id
}

output "aks_pod_baseline_assignment_id" {
  value = azurerm_subscription_policy_assignment.aks_pod_security_baseline.id
}

output "defender_plans_enabled" {
  value = keys(azurerm_security_center_subscription_pricing.plans)
}
