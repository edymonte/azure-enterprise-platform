# 20-governance — Azure Policy guardrails + Microsoft Defender for Cloud.
#
# Scope is the whole subscription, like a real platform team would do.
# Policies start in Audit mode; switching to Deny is a game-day exercise.

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

data "azurerm_subscription" "current" {}

locals {
  policy_dir = "${path.module}/../../policies"

  # Built-in definitions (IDs are stable across tenants)
  builtin_allowed_locations   = "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c"
  builtin_aks_baseline_linux  = "/providers/Microsoft.Authorization/policySetDefinitions/a8640138-9b0a-4a28-b8cb-1666c838647d"
  effect_parameter_definition = { type = "String", allowedValues = ["Audit", "Deny", "Disabled"], defaultValue = "Audit" }
}

# ---------------------------------------------------------------------------
# Custom policy definitions (policy-as-code: rules live in /infra/policies)
# ---------------------------------------------------------------------------
resource "azurerm_policy_definition" "require_rg_tags" {
  name         = "${var.org}-require-rg-tags"
  policy_type  = "Custom"
  mode         = "All"
  display_name = "[${upper(var.org)}] Resource groups must carry the mandatory tags"
  policy_rule  = file("${local.policy_dir}/require-rg-tags.rule.json")

  parameters = jsonencode({
    tagNames = { type = "Array", metadata = { displayName = "Mandatory tag names" } }
    effect   = local.effect_parameter_definition
  })

  metadata = jsonencode({ category = "Tags", version = "1.0.0" })
}

resource "azurerm_policy_definition" "sql_no_public_network" {
  name         = "${var.org}-sql-deny-public-network"
  policy_type  = "Custom"
  mode         = "All"
  display_name = "[${upper(var.org)}] Azure SQL servers must disable public network access"
  policy_rule  = file("${local.policy_dir}/sql-deny-public-network.rule.json")

  parameters = jsonencode({
    effect = local.effect_parameter_definition
  })

  metadata = jsonencode({ category = "SQL", version = "1.0.0" })
}

# ---------------------------------------------------------------------------
# Initiative = one assignment, one compliance score, many controls.
# ---------------------------------------------------------------------------
resource "azurerm_policy_set_definition" "platform_guardrails" {
  name         = "${var.org}-platform-guardrails"
  policy_type  = "Custom"
  display_name = "[${upper(var.org)}] Platform guardrails"

  parameters = jsonencode({
    allowedLocations = { type = "Array", metadata = { displayName = "Allowed locations" } }
    mandatoryTags    = { type = "Array", metadata = { displayName = "Mandatory RG tags" } }
    guardrailEffect  = local.effect_parameter_definition
  })

  policy_definition_reference {
    reference_id         = "allowedLocations"
    policy_definition_id = local.builtin_allowed_locations
    parameter_values = jsonencode({
      listOfAllowedLocations = { value = "[parameters('allowedLocations')]" }
    })
  }

  policy_definition_reference {
    reference_id         = "requireRgTags"
    policy_definition_id = azurerm_policy_definition.require_rg_tags.id
    parameter_values = jsonencode({
      tagNames = { value = "[parameters('mandatoryTags')]" }
      effect   = { value = "[parameters('guardrailEffect')]" }
    })
  }

  policy_definition_reference {
    reference_id         = "sqlNoPublicNetwork"
    policy_definition_id = azurerm_policy_definition.sql_no_public_network.id
    parameter_values = jsonencode({
      effect = { value = "[parameters('guardrailEffect')]" }
    })
  }
}

resource "azurerm_subscription_policy_assignment" "platform_guardrails" {
  name                 = "${var.org}-platform-guardrails"
  display_name         = "[${upper(var.org)}] Platform guardrails"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = azurerm_policy_set_definition.platform_guardrails.id

  parameters = jsonencode({
    allowedLocations = { value = var.allowed_locations }
    mandatoryTags    = { value = var.mandatory_tags }
    guardrailEffect  = { value = var.guardrail_effect }
  })

  non_compliance_message {
    content = "Blocked/flagged by MFS platform guardrails. See docs/labs/04-governance.md."
  }
}

# Built-in initiative evaluated by the AKS Azure Policy add-on (Gatekeeper).
resource "azurerm_subscription_policy_assignment" "aks_pod_security_baseline" {
  name                 = "${var.org}-aks-pod-baseline"
  display_name         = "[${upper(var.org)}] AKS pod security baseline (Linux)"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = local.builtin_aks_baseline_linux

  parameters = jsonencode({
    effect = { value = lower(var.aks_policy_effect) }
  })
}

# ---------------------------------------------------------------------------
# Microsoft Defender for Cloud — use the 30-day plan trials, then disable.
# ---------------------------------------------------------------------------
resource "azurerm_security_center_subscription_pricing" "plans" {
  for_each      = var.enable_defender ? toset(var.defender_plans) : toset([])
  tier          = "Standard"
  resource_type = each.value
  subplan       = each.value == "KeyVaults" ? "PerKeyVault" : null
}

resource "azurerm_security_center_contact" "platform" {
  count               = var.enable_defender ? 1 : 0
  name                = "platform"
  email               = var.alert_email
  alert_notifications = true
  alerts_to_admins    = true
}
