# 10-foundation — hub & spoke network, private DNS, shared observability sinks.

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

locals {
  tags = merge(var.tags, {
    Environment = var.environment
    Layer       = "10-foundation"
  })

  private_dns_zones = toset([
    "privatelink.vaultcore.azure.net",
    "privatelink.database.windows.net",
  ])
}

resource "azurerm_resource_group" "hub" {
  name     = "rg-${var.org}-hub-${var.environment}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_resource_group" "spoke" {
  name     = "rg-${var.org}-portal-${var.environment}"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------------------
# Network: hub (shared services) + spoke (customer portal workload)
# ---------------------------------------------------------------------------
resource "azurerm_virtual_network" "hub" {
  name                = "vnet-${var.org}-hub-${var.environment}"
  location            = azurerm_resource_group.hub.location
  resource_group_name = azurerm_resource_group.hub.name
  address_space       = [var.hub_cidr]
  tags                = local.tags
}

resource "azurerm_subnet" "hub_shared" {
  name                 = "snet-shared"
  resource_group_name  = azurerm_resource_group.hub.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = [cidrsubnet(var.hub_cidr, 8, 0)]
}

resource "azurerm_virtual_network" "spoke" {
  name                = "vnet-${var.org}-portal-${var.environment}"
  location            = azurerm_resource_group.spoke.location
  resource_group_name = azurerm_resource_group.spoke.name
  address_space       = [var.spoke_cidr]
  tags                = local.tags
}

resource "azurerm_subnet" "aks" {
  name                 = "snet-aks"
  resource_group_name  = azurerm_resource_group.spoke.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = [cidrsubnet(var.spoke_cidr, 6, 0)] # /22 — nodes only (Azure CNI Overlay)
}

resource "azurerm_subnet" "private_endpoints" {
  name                 = "snet-private-endpoints"
  resource_group_name  = azurerm_resource_group.spoke.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = [cidrsubnet(var.spoke_cidr, 8, 8)] # /24
}

resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  name                         = "peer-hub-to-portal"
  resource_group_name          = azurerm_resource_group.hub.name
  virtual_network_name         = azurerm_virtual_network.hub.name
  remote_virtual_network_id    = azurerm_virtual_network.spoke.id
  allow_forwarded_traffic      = true
  allow_virtual_network_access = true
}

resource "azurerm_virtual_network_peering" "spoke_to_hub" {
  name                         = "peer-portal-to-hub"
  resource_group_name          = azurerm_resource_group.spoke.name
  virtual_network_name         = azurerm_virtual_network.spoke.name
  remote_virtual_network_id    = azurerm_virtual_network.hub.id
  allow_forwarded_traffic      = true
  allow_virtual_network_access = true
}

# ---------------------------------------------------------------------------
# NSG on the AKS subnet: HTTP(S) only from Azure Front Door (service tag).
# Direct Internet access to the ingress public IP is denied.
# ---------------------------------------------------------------------------
resource "azurerm_network_security_group" "aks" {
  name                = "nsg-${var.org}-aks-${var.environment}"
  location            = azurerm_resource_group.spoke.location
  resource_group_name = azurerm_resource_group.spoke.name
  tags                = local.tags
}

resource "azurerm_network_security_rule" "allow_front_door" {
  name                        = "Allow-FrontDoor-Http"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_ranges     = ["80", "443"]
  source_address_prefix       = "AzureFrontDoor.Backend"
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.spoke.name
  network_security_group_name = azurerm_network_security_group.aks.name
}

resource "azurerm_network_security_rule" "allow_operator" {
  count                       = length(var.operator_ip_ranges) > 0 ? 1 : 0
  name                        = "Allow-Operator-Http"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_ranges     = ["80", "443"]
  source_address_prefixes     = var.operator_ip_ranges
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.spoke.name
  network_security_group_name = azurerm_network_security_group.aks.name
}

resource "azurerm_network_security_rule" "deny_internet_http" {
  name                        = "Deny-Internet-Http"
  priority                    = 4000
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_ranges     = ["80", "443"]
  source_address_prefix       = "Internet"
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.spoke.name
  network_security_group_name = azurerm_network_security_group.aks.name
}

resource "azurerm_subnet_network_security_group_association" "aks" {
  subnet_id                 = azurerm_subnet.aks.id
  network_security_group_id = azurerm_network_security_group.aks.id
}

# ---------------------------------------------------------------------------
# Private DNS zones live in the hub and are linked to every VNet.
# ---------------------------------------------------------------------------
resource "azurerm_private_dns_zone" "this" {
  for_each            = local.private_dns_zones
  name                = each.value
  resource_group_name = azurerm_resource_group.hub.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "hub" {
  for_each              = local.private_dns_zones
  name                  = "link-hub"
  resource_group_name   = azurerm_resource_group.hub.name
  private_dns_zone_name = azurerm_private_dns_zone.this[each.key].name
  virtual_network_id    = azurerm_virtual_network.hub.id
  tags                  = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "spoke" {
  for_each              = local.private_dns_zones
  name                  = "link-portal"
  resource_group_name   = azurerm_resource_group.hub.name
  private_dns_zone_name = azurerm_private_dns_zone.this[each.key].name
  virtual_network_id    = azurerm_virtual_network.spoke.id
  tags                  = local.tags
}

# ---------------------------------------------------------------------------
# Shared observability sinks (Azure-native stack)
# ---------------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${var.org}-${var.environment}"
  location            = azurerm_resource_group.hub.location
  resource_group_name = azurerm_resource_group.hub.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = var.log_daily_quota_gb
  tags                = local.tags
}

resource "azurerm_monitor_workspace" "prometheus" {
  name                = "amw-${var.org}-${var.environment}"
  location            = azurerm_resource_group.hub.location
  resource_group_name = azurerm_resource_group.hub.name
  tags                = local.tags
}

resource "azurerm_monitor_action_group" "platform" {
  name                = "ag-${var.org}-platform-${var.environment}"
  resource_group_name = azurerm_resource_group.hub.name
  short_name          = "platform"

  email_receiver {
    name                    = "platform-oncall"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }

  tags = local.tags
}
