# Phase 10 — Edge: DNS, Front Door, WAF and Traffic Manager (5 h)

## 🎯 Goal

Publish the portal at `https://portal.edymonte.com.br` (prod) and `https://portal-dev.edymonte.com.br` (dev) through Front Door with managed certificates and a WAF; then run a DNS-based DR exercise with Traffic Manager.

> 💰 Front Door Premium has an hourly base fee. Apply this layer when you start the phase and **destroy it when you finish** (`./scripts/azp.ps1 destroy 50-edge`).

## 🧠 Concepts

| Service | Layer | Scope | Typical use |
|---|---|---|---|
| **Front Door** | L7 (HTTP) proxy + CDN + WAF | Global (anycast) | Public web apps, multi-region HTTP |
| **Application Gateway** | L7 proxy + WAF | Regional, inside a VNet | Regional apps, internal apps |
| **Traffic Manager** | DNS answers only | Global | Any protocol; failover/geo routing by DNS |
| **Load Balancer** | L4 | Regional | TCP/UDP |

**Custom domain flow** in `50-edge/main.tf`: `custom_domain` → Azure gives a **validation token** → Terraform writes the `_dnsauth.<host>` TXT record in *your* zone → Front Door validates ownership and issues a **managed certificate** → `CNAME` points the host at the Front Door endpoint. All in code; no portal step.

## 🛠️ Steps

### 1. Preconditions

- The domain delegation from phase 01 is live (`Resolve-DnsName edymonte.com.br -Type NS`).
- Both portal environments are healthy (phase 07).

### 2. Read the code

| Snippet | Why |
|---|---|
| `local.hosts = { prod = "portal", dev = "portal-dev" }` | One `for_each` map drives custom domains, TXT records, CNAMEs and associations. Adding `qa` is one line. |
| origin `host_name = local.aks.ingress_fqdn`, no `origin_host_header` | Front Door forwards the original Host, so NGINX can route by host. |
| `forwarding_protocol = "HttpOnly"` | TLS ends at the edge; origin over HTTP is restricted by NSG. Trade-off documented in ADR-0005. |
| `depends_on = [azurerm_cdn_frontdoor_route.portal]` on the CNAME | The dependency is real but not visible through references. |
| `mode = var.waf_mode` default `Detection` | Observe before blocking. |
| `dynamic "managed_rule"` only for Premium | Managed rule sets require the Premium SKU. |

### 3. Apply

```powershell
./scripts/azp.ps1 apply 50-edge
```

Certificate validation and propagation take from a few minutes up to ~1 hour. Track it:

```powershell
az afd custom-domain list -g rg-mfs-edge-lab --profile-name afd-mfs-portal-lab `
  --query "[].{host:hostName, validation:domainValidationState, deploy:deploymentStatus}" -o table
```

### 4. Test

```powershell
curl.exe -sI https://portal.edymonte.com.br             # 200, served by Front Door (x-azure-ref header)
curl.exe -s  https://portal-dev.edymonte.com.br/api/info
curl.exe -sI http://portal.edymonte.com.br              # 307 → https
```

### 5. WAF: Detection → Prevention

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" "https://portal.edymonte.com.br/api/products?id=1' OR '1'='1"
# Detection: 200 (only logged)
./scripts/azp.ps1 apply 50-edge -Var 'waf_mode=Prevention'
curl.exe -s -o NUL -w "%{http_code}`n" "https://portal.edymonte.com.br/api/products?id=1' OR '1'='1"
# Prevention: 403
```

### 6. Traffic Manager DR exercise

```powershell
./scripts/azp.ps1 apply 50-edge -Var 'enable_traffic_manager_lab=true' -Var 'waf_mode=Prevention'
Resolve-DnsName portal-dr.edymonte.com.br -Server 8.8.8.8     # CNAME chain ends at ...-primary-...eastus2.azurecontainer.io
az container stop -g rg-mfs-dr-lab -n aci-mfs-portal-primary
# wait ~1–2 min (probe interval 30 s × 2 failures + TTL 30 s)
Resolve-DnsName portal-dr.edymonte.com.br -Server 8.8.8.8     # now ...-dr-...brazilsouth...
az container start -g rg-mfs-dr-lab -n aci-mfs-portal-primary
```

The evidence of a **DNS-based** failover is the DNS answer itself — the client is never proxied. That is the core difference from Front Door.

## ✅ Checkpoint

- [ ] Both hosts serve HTTPS with a valid certificate.
- [ ] Direct access to the ingress IP from outside your IP fails (NSG); access through Front Door works.
- [ ] SQL injection probe: 200 in Detection, 403 in Prevention.
- [ ] Traffic Manager answer moves to the DR site when the primary stops.

## 💥 Break it — origin bypass

Ask a friend (or use your phone on 4G) to `curl http://<ingress-ip>/` with the Host header. It times out — the NSG only allows `AzureFrontDoor.Backend` and your IP. **But:** *any* Front Door customer shares that service tag. How do you guarantee only **your** Front Door reaches the origin? → Challenge.

## 🏋️ Challenge — lock the origin to your Front Door

1. Send Front Door WAF logs to Log Analytics (`azurerm_monitor_diagnostic_setting` on the profile).
2. Make the ingress reject requests without your `X-Azure-FDID`.

<details><summary>Answer</summary>

1. In `50-edge`, add a remote state for `10-foundation` (see `remote-state.tf` in other layers) and:

```hcl
resource "azurerm_monitor_diagnostic_setting" "afd" {
  name                       = "afd-to-law"
  target_resource_id         = azurerm_cdn_frontdoor_profile.this.id
  log_analytics_workspace_id = data.terraform_remote_state.foundation.outputs.log_analytics_workspace_id

  enabled_log { category = "FrontDoorAccessLog" }
  enabled_log { category = "FrontDoorWebApplicationFirewallLog" }
}
```

KQL: `AzureDiagnostics | where Category == "FrontDoorWebApplicationFirewallLog" | project TimeGenerated, ruleName_s, action_s, requestUri_s`.

2. Output `front_door_profile_resource_guid` already exists. The managed NGINX disallows configuration snippets, so enforce it at the app or with a WAF-like check: add a middleware to the API that returns 403 when `req.get('X-Azure-FDID') !== process.env.ALLOWED_FDID`, set `ALLOWED_FDID` through Helm values. Production answer: **Front Door Premium Private Link** to an internal load balancer — the origin then has no public IP at all.

</details>

## 🎤 Interview

1. Front Door vs Application Gateway vs Traffic Manager — when each? When combine them?
2. How does Front Door issue a certificate for your domain?
3. Why roll out a WAF in Detection first?
4. How do you stop clients from bypassing Front Door?
5. Why is DNS-based failover slower than Front Door's origin failover? *(TTL + resolver caching.)*
