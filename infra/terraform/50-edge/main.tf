# 50-edge — public entry: Azure DNS records, Front Door + WAF, and an optional
# Traffic Manager DR lab. This is the most expensive layer (Front Door Premium
# has a monthly base fee billed hourly): apply it only during phase 7.

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

locals {
  aks = data.terraform_remote_state.aks.outputs

  # host label => environment. portal.edymonte.com.br, portal-dev.edymonte.com.br
  hosts = {
    prod = var.prod_host_label
    dev  = var.dev_host_label
  }

  origin_host = var.origin_host_override != "" ? var.origin_host_override : local.aks.ingress_fqdn

  tags = merge(var.tags, {
    Environment = var.environment
    Layer       = "50-edge"
  })
}

data "azurerm_dns_zone" "public" {
  name                = var.dns_zone_name
  resource_group_name = var.dns_zone_resource_group_name
}

resource "azurerm_resource_group" "edge" {
  name     = "rg-${var.org}-edge-${var.environment}"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------------------
# Front Door Standard/Premium
# ---------------------------------------------------------------------------
resource "azurerm_cdn_frontdoor_profile" "this" {
  name                     = "afd-${var.org}-portal-${var.environment}"
  resource_group_name      = azurerm_resource_group.edge.name
  sku_name                 = var.front_door_sku
  response_timeout_seconds = 60
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "portal" {
  name                     = "fde-${var.org}-portal-${var.environment}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_origin_group" "aks" {
  name                     = "og-aks"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }

  # Single origin: health probes are intentionally omitted (Microsoft guidance).
  # Add a second region + probe on /healthz when you build multi-region.
}

resource "azurerm_cdn_frontdoor_origin" "aks_ingress" {
  name                          = "aks-ingress"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.aks.id
  enabled                       = true
  host_name                     = local.origin_host
  # origin_host_header omitted: the client Host (portal / portal-dev) is
  # forwarded, so the NGINX ingress can route by host.
  http_port                      = 80
  https_port                     = 443
  priority                       = 1
  weight                         = 1000
  certificate_name_check_enabled = false
}

resource "azurerm_cdn_frontdoor_custom_domain" "portal" {
  for_each                 = local.hosts
  name                     = "cd-portal-${each.key}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  dns_zone_id              = data.azurerm_dns_zone.public.id
  host_name                = "${each.value}.${var.dns_zone_name}"

  tls {
    certificate_type = "ManagedCertificate"
  }
}

# Domain ownership validation for the managed certificate.
resource "azurerm_dns_txt_record" "validation" {
  for_each            = local.hosts
  name                = "_dnsauth.${each.value}"
  zone_name           = data.azurerm_dns_zone.public.name
  resource_group_name = data.azurerm_dns_zone.public.resource_group_name
  ttl                 = 3600

  record {
    value = azurerm_cdn_frontdoor_custom_domain.portal[each.key].validation_token
  }
}

resource "azurerm_cdn_frontdoor_route" "portal" {
  name                            = "route-portal"
  cdn_frontdoor_endpoint_id       = azurerm_cdn_frontdoor_endpoint.portal.id
  cdn_frontdoor_origin_group_id   = azurerm_cdn_frontdoor_origin_group.aks.id
  cdn_frontdoor_origin_ids        = [azurerm_cdn_frontdoor_origin.aks_ingress.id]
  cdn_frontdoor_custom_domain_ids = [for d in azurerm_cdn_frontdoor_custom_domain.portal : d.id]
  supported_protocols             = ["Http", "Https"]
  patterns_to_match               = ["/*"]
  forwarding_protocol             = "HttpOnly" # TLS terminates at the edge (see ADR-0005)
  https_redirect_enabled          = true
  link_to_default_domain          = true
}

resource "azurerm_cdn_frontdoor_custom_domain_association" "portal" {
  for_each                       = local.hosts
  cdn_frontdoor_custom_domain_id = azurerm_cdn_frontdoor_custom_domain.portal[each.key].id
  cdn_frontdoor_route_ids        = [azurerm_cdn_frontdoor_route.portal.id]
}

resource "azurerm_dns_cname_record" "portal" {
  for_each            = local.hosts
  name                = each.value
  zone_name           = data.azurerm_dns_zone.public.name
  resource_group_name = data.azurerm_dns_zone.public.resource_group_name
  ttl                 = 300
  record              = azurerm_cdn_frontdoor_endpoint.portal.host_name

  depends_on = [azurerm_cdn_frontdoor_route.portal]
}

# ---------------------------------------------------------------------------
# WAF — starts in Detection (observe first), Prevention is a game-day step.
# Managed rule sets require the Premium SKU.
# ---------------------------------------------------------------------------
resource "azurerm_cdn_frontdoor_firewall_policy" "portal" {
  name                = "waf${var.org}portal${var.environment}"
  resource_group_name = azurerm_resource_group.edge.name
  sku_name            = var.front_door_sku
  enabled             = true
  mode                = var.waf_mode

  custom_rule {
    name                           = "RateLimitPerClient"
    enabled                        = true
    priority                       = 100
    type                           = "RateLimitRule"
    rate_limit_duration_in_minutes = 1
    rate_limit_threshold           = var.waf_rate_limit_per_minute
    action                         = "Block"

    match_condition {
      match_variable = "RequestUri"
      operator       = "Contains"
      match_values   = ["/"]
    }
  }

  dynamic "managed_rule" {
    for_each = var.front_door_sku == "Premium_AzureFrontDoor" ? [
      { type = "Microsoft_DefaultRuleSet", version = "2.1" },
      { type = "Microsoft_BotManagerRuleSet", version = "1.1" },
    ] : []
    content {
      type    = managed_rule.value.type
      version = managed_rule.value.version
      action  = "Block"
    }
  }

  tags = local.tags
}

resource "azurerm_cdn_frontdoor_security_policy" "portal" {
  name                     = "secpol-portal"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id

  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.portal.id

      association {
        patterns_to_match = ["/*"]

        domain {
          cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.portal.id
        }

        dynamic "domain" {
          for_each = azurerm_cdn_frontdoor_custom_domain.portal
          content {
            cdn_frontdoor_domain_id = domain.value.id
          }
        }
      }
    }
  }
}
