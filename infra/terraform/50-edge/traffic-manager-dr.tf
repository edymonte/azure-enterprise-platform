# Traffic Manager DR lab (optional, cheap) — DNS-level failover between two
# regions. Two tiny Container Instances stand in for "primary" and "DR" sites.
#
# Why not put Traffic Manager in front of Front Door? Both are global; for HTTP
# the real-world answer is Front Door with a multi-region origin group. Traffic
# Manager is the tool for DNS-based routing (non-HTTP, or regional endpoints).
# This lab exists so you can SEE and explain that difference (ADR-0005).

locals {
  dr_sites = var.enable_traffic_manager_lab ? {
    primary = { location = var.location, priority = 1 }
    dr      = { location = var.dr_location, priority = 2 }
  } : {}
}

resource "azurerm_resource_group" "dr" {
  count    = var.enable_traffic_manager_lab ? 1 : 0
  name     = "rg-${var.org}-dr-${var.environment}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_container_group" "site" {
  for_each            = local.dr_sites
  name                = "aci-${var.org}-portal-${each.key}"
  location            = each.value.location
  resource_group_name = azurerm_resource_group.dr[0].name
  os_type             = "Linux"
  ip_address_type     = "Public"
  dns_name_label      = "${var.org}-portal-${each.key}-${var.name_suffix}"

  container {
    name   = "web"
    image  = "mcr.microsoft.com/azuredocs/aci-helloworld:latest"
    cpu    = 0.5
    memory = 0.5

    ports {
      port     = 80
      protocol = "TCP"
    }
  }

  tags = local.tags
}

resource "azurerm_traffic_manager_profile" "dr" {
  count                  = var.enable_traffic_manager_lab ? 1 : 0
  name                   = "tm-${var.org}-portal-${var.name_suffix}"
  resource_group_name    = azurerm_resource_group.dr[0].name
  traffic_routing_method = "Priority"

  dns_config {
    relative_name = "${var.org}-portal-${var.name_suffix}"
    ttl           = 30
  }

  monitor_config {
    protocol                     = "HTTP"
    port                         = 80
    path                         = "/"
    interval_in_seconds          = 30
    timeout_in_seconds           = 10
    tolerated_number_of_failures = 2
  }

  tags = local.tags
}

resource "azurerm_traffic_manager_external_endpoint" "site" {
  for_each   = local.dr_sites
  name       = each.key
  profile_id = azurerm_traffic_manager_profile.dr[0].id
  target     = azurerm_container_group.site[each.key].fqdn
  priority   = each.value.priority
}

resource "azurerm_dns_cname_record" "dr" {
  count               = var.enable_traffic_manager_lab ? 1 : 0
  name                = var.dr_host_label
  zone_name           = data.azurerm_dns_zone.public.name
  resource_group_name = data.azurerm_dns_zone.public.resource_group_name
  ttl                 = 30
  record              = azurerm_traffic_manager_profile.dr[0].fqdn
}
