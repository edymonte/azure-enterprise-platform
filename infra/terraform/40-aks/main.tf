# 40-aks — AKS platform for the customer portal.
#
# Cluster access model: Entra ID + Azure RBAC only (local accounts disabled).
# Delivery model: GitOps (Argo CD) — CI pipelines never talk to the cluster.

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

data "azurerm_client_config" "current" {}

locals {
  foundation = data.terraform_remote_state.foundation.outputs
  data_layer = data.terraform_remote_state.data.outputs
  rg_name    = local.foundation.spoke_resource_group_name
  location   = local.foundation.location
  name       = "${var.org}-portal-${var.environment}"
  admins     = toset(concat([data.azurerm_client_config.current.object_id], var.cluster_admin_object_ids))

  # Kubernetes namespaces that host the portal (one per GitOps environment)
  portal_namespaces = ["portal-dev", "portal-prod"]

  tags = merge(var.tags, {
    Environment = var.environment
    Layer       = "40-aks"
  })
}

# ---------------------------------------------------------------------------
# Container registry
# ---------------------------------------------------------------------------
resource "azurerm_container_registry" "this" {
  name                = "acr${var.org}portal${var.name_suffix}"
  resource_group_name = local.rg_name
  location            = local.location
  sku                 = var.acr_sku
  admin_enabled       = false
  tags                = local.tags
}

# ---------------------------------------------------------------------------
# AKS cluster
# ---------------------------------------------------------------------------
resource "azurerm_kubernetes_cluster" "this" {
  name                      = "aks-${local.name}"
  location                  = local.location
  resource_group_name       = local.rg_name
  dns_prefix                = local.name
  kubernetes_version        = var.kubernetes_version
  sku_tier                  = var.sku_tier
  automatic_upgrade_channel = "patch"
  node_os_upgrade_channel   = "NodeImage"

  oidc_issuer_enabled       = true
  workload_identity_enabled = true
  local_account_disabled    = true
  azure_policy_enabled      = true

  default_node_pool {
    name                         = "system"
    vm_size                      = var.system_node_vm_size
    auto_scaling_enabled         = true
    min_count                    = var.system_node_min_count
    max_count                    = var.system_node_max_count
    vnet_subnet_id               = local.foundation.aks_subnet_id
    only_critical_addons_enabled = var.enable_user_pool
    temporary_name_for_rotation  = "sysrot"

    upgrade_settings {
      max_surge = "33%"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled = true
    tenant_id          = data.azurerm_client_config.current.tenant_id
  }

  dynamic "api_server_access_profile" {
    for_each = length(local.foundation.operator_ip_ranges) > 0 ? [1] : []
    content {
      authorized_ip_ranges = local.foundation.operator_ip_ranges
    }
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_data_plane  = "cilium"
    network_policy      = "cilium"
    load_balancer_sku   = "standard"
    outbound_type       = "loadBalancer"
    pod_cidr            = "192.168.0.0/16"
    service_cidr        = "172.16.0.0/16"
    dns_service_ip      = "172.16.0.10"
  }

  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "2m"
  }

  # Managed NGINX ingress (application routing add-on)
  web_app_routing {
    dns_zone_ids = []
  }

  # Container Insights (logs) — MSI auth, data collection rule below
  oms_agent {
    log_analytics_workspace_id      = local.foundation.log_analytics_workspace_id
    msi_auth_for_monitoring_enabled = true
  }

  # Azure Managed Prometheus (metrics)
  monitor_metrics {}

  dynamic "microsoft_defender" {
    for_each = var.enable_defender_sensor ? [1] : []
    content {
      log_analytics_workspace_id = local.foundation.log_analytics_workspace_id
    }
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [kubernetes_version, default_node_pool[0].node_count]
  }
}

resource "azurerm_kubernetes_cluster_node_pool" "user" {
  count                 = var.enable_user_pool ? 1 : 0
  name                  = "apps"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  vm_size               = var.user_node_vm_size
  vnet_subnet_id        = local.foundation.aks_subnet_id
  mode                  = "User"
  auto_scaling_enabled  = true
  min_count             = 1
  max_count             = var.user_node_max_count

  node_labels = {
    workload = "application"
  }

  upgrade_settings {
    max_surge = "33%"
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------
resource "azurerm_role_assignment" "acr_pull" {
  scope                            = azurerm_container_registry.this.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
  skip_service_principal_aad_check = true
}

# Lets the cloud provider attach the pre-created ingress public IP (spoke RG).
resource "azurerm_role_assignment" "cluster_network_contributor" {
  scope                = local.foundation.spoke_resource_group_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.this.identity[0].principal_id
}

resource "azurerm_role_assignment" "cluster_admin" {
  for_each             = local.admins
  scope                = azurerm_kubernetes_cluster.this.id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "cluster_user" {
  for_each             = local.admins
  scope                = azurerm_kubernetes_cluster.this.id
  role_definition_name = "Azure Kubernetes Service Cluster User Role"
  principal_id         = each.value
}

# ---------------------------------------------------------------------------
# Static ingress IP — stable origin for Front Door across cluster rebuilds.
# Consumed by gitops/platform/ingress/nginx-controller.yaml.
# ---------------------------------------------------------------------------
resource "azurerm_public_ip" "ingress" {
  name                = "pip-${local.name}-ingress"
  location            = local.location
  resource_group_name = local.rg_name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = "${var.org}-portal-${var.name_suffix}"
  tags                = local.tags
}

# ---------------------------------------------------------------------------
# Workload identity for the portal API (Key Vault + Azure SQL, no secrets)
# ---------------------------------------------------------------------------
resource "azurerm_user_assigned_identity" "portal_api" {
  name                = "id-${local.name}-api"
  location            = local.location
  resource_group_name = local.rg_name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "portal_api" {
  for_each            = toset(local.portal_namespaces)
  name                = "fic-${each.value}"
  resource_group_name = local.rg_name
  parent_id           = azurerm_user_assigned_identity.portal_api.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = azurerm_kubernetes_cluster.this.oidc_issuer_url
  subject             = "system:serviceaccount:${each.value}:customer-portal-api"
}

resource "azurerm_role_assignment" "portal_api_kv" {
  scope                = local.data_layer.key_vault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.portal_api.principal_id
}
