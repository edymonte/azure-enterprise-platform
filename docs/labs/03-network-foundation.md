# Phase 03 — Hub & spoke network (4 h)

## 🎯 Goal

Build the network everything lives in: a **hub** VNet (shared services) and a **spoke** VNet (the portal), with peering, an NSG that only accepts Front Door, **private DNS** zones and the observability sinks.

## 🧠 Concepts

```text
            hub VNet 10.50.0.0/16                        spoke VNet (portal) 10.60.0.0/16
   ┌──────────────────────────────────┐   peering   ┌──────────────────────────────────────┐
   │ snet-shared   10.50.0.0/24       │◄──────────►│ snet-aks               10.60.0.0/22  │
   │ Private DNS zones (linked to both)│             │   NSG: 80/443 only from AzureFrontDoor│
   │ Log Analytics · Prometheus (AMW) │             │ snet-private-endpoints 10.60.8.0/24  │
   └──────────────────────────────────┘             └──────────────────────────────────────┘
```

- **Why hub & spoke?** Shared services (DNS, firewall, observability) live once in the hub; each workload gets an isolated spoke. In production the hub would also hold Azure Firewall and VPN/ExpressRoute; here it stays lean for cost (ADR-0001).
- **Why is a `/22` enough for AKS?** With **Azure CNI Overlay**, pods get IPs from a CIDR *outside* the VNet (`192.168.0.0/16`). The subnet only needs IPs for **nodes**.
- A **service tag** such as `AzureFrontDoor.Backend` is an IP list maintained by Microsoft. The NSG rule does not need to know the IPs.

## 🛠️ Steps

### 1. IP planning with `cidrsubnet` (understand before applying)

```powershell
terraform -chdir=infra/terraform/10-foundation console
> cidrsubnet("10.60.0.0/16", 6, 0)    # snet-aks
"10.60.0.0/22"
> cidrsubnet("10.60.0.0/16", 8, 8)    # snet-private-endpoints
"10.60.8.0/24"
> exit
```

`cidrsubnet(prefix, new_bits, netnum)`: `/16 + 6 bits = /22`. This is how network teams avoid spreadsheets: the addressing plan lives in code.

### 2. Read the code

| Resource | Question to answer while reading |
|---|---|
| `azurerm_virtual_network_peering` (2 blocks) | Why must peering be created **on both sides**? |
| `azurerm_network_security_rule.deny_internet_http` | Priority 4000: why higher (evaluated later) than the Front Door rule (100)? |
| `azurerm_private_dns_zone_virtual_network_link` | What would happen if the zone were linked to the hub only? |
| `azurerm_log_analytics_workspace.daily_quota_gb` | Which cost risk does this prevent? |

### 3. Apply

```powershell
./scripts/azp.ps1 apply 10-foundation
```

## ✅ Checkpoint

```powershell
az network vnet peering list -g rg-mfs-hub-lab --vnet-name vnet-mfs-hub-lab --query "[].{name:name,state:peeringState}" -o table
az network nsg rule list -g rg-mfs-portal-lab --nsg-name nsg-mfs-aks-lab -o table
az network private-dns link vnet list -g rg-mfs-hub-lab -z privatelink.vaultcore.azure.net -o table
```

- [ ] Peering `Connected` in both directions.
- [ ] 3 NSG rules (Front Door 100, your IP 110, deny Internet 4000).
- [ ] Each private zone linked to both VNets.

## 💥 Break it — drift

1. In the portal, delete the `link-portal` link from the `privatelink.database.windows.net` zone.
2. Run `./scripts/azp.ps1 plan 10-foundation`.

- **Observation:** the plan shows `+ create` for something that "already existed".
- **Concept:** *drift* is the difference between state and reality. `plan` always refreshes from Azure before comparing.
- **Question:** if this link disappeared in production, what would the symptom be in phase 07? *(The API would resolve SQL to its public IP, which is blocked → connection timeout.)*
- Apply to fix it. In a company, a scheduled `plan` (drift detection) would warn you before the incident.

## 🎤 Interview

1. Hub & spoke vs one large VNet with many subnets: when would you choose each?
2. Is VNet peering transitive? If spoke A and spoke B both peer with the hub, can A reach B?
3. Why do private DNS zones live in the hub and get linked to the spokes?
4. With CNI Overlay, how many VNet IPs does a pod consume?
