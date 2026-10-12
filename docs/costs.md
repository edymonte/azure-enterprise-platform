# Costs and trial limits

> Rough figures for `eastus2`, to give you the order of magnitude. **Always confirm in the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)** — prices change, and a Brazilian trial may be billed in BRL.

## Per layer (running 8 h/day)

| Layer | What costs money | Order of magnitude | Strategy |
|---|---|---|---|
| `00-bootstrap` | LRS storage + DNS zone | cents per day | Kept for the whole lab |
| `05-identity` | nothing | 0 | Kept for the whole lab |
| `10-foundation` | Log Analytics (1 GB/day cap), VNets/NSG/peering (near zero) | low | Up/down daily |
| `20-governance` | Policy: free. **Defender**: per resource/hour | 0 during the 30-day plan trials | Disable plans when the trial ends (`enable_defender=false`) |
| `30-data` | SQL Basic + 2 private endpoints + Key Vault | low | Up/down daily |
| `40-aks` | **Nodes** (2 × D2s_v5), public IP, Managed Prometheus | the largest recurring cost | `down` every day; `az aks stop` for short breaks |
| `50-edge` | **Front Door Premium**: monthly base fee billed hourly + requests | the most expensive per hour | Only during phase 10 and edge game days; destroy right after |
| `50-edge` (TM lab) | 2 × ACI 0.5 vCPU + Traffic Manager | low | Only during the DR exercise |
| `60-observability` | Managed Grafana Standard (per instance/hour) | medium | Only in phases 11–13 |
| `70-datadog` | Datadog trial account (14 days) | 0 during the trial | Create the account only at phase 12 |

## Trial pitfalls

1. **vCPU quota**: trial subscriptions usually have **4 vCPUs per region**. That is why AKS uses 1–2 D2s_v5 nodes and `enable_user_pool=false`. For a dedicated node pool, upgrade to pay-as-you-go (remaining credit is kept) and request a quota increase.
2. **Credit runs out before day 30** if you forget Front Door or AKS running. The budget (`00-bootstrap`) e-mails you at 50% / 80% / 100%.
3. **Marketplace**: some marketplace offers are blocked on trials. That is why Datadog is integrated through the Agent (Helm/Operator) and not the "Datadog – An Azure Native ISV Service" resource.
4. **Currency**: `monthly_budget_amount` is in the subscription billing currency. Check *Cost Management → Budgets* after bootstrap.

## Habits that become interview answers

- Mandatory `Owner`, `Environment`, `CostCenter` tags (policy) → cost traceable to an owner.
- Daily ingestion cap on Log Analytics → protects against a logging loop.
- Ephemeral environments recreated from IaC → cost proportional to usage.
