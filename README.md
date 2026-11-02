# Azure Enterprise Platform

A reference platform for a fictional financial-services company (**Monteiro Financial Services**), defined end to end as code with **Terraform** and operated through pipelines, with no stored secrets.

**AKS · GitOps (Argo CD) · Azure Policy · Defender for Cloud · Azure SQL · Key Vault · Private Endpoints · Front Door + WAF · Azure DNS · Traffic Manager · Managed Prometheus/Grafana · Datadog · GitHub Actions · Azure DevOps**

> Start with **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**: the whole environment explained layer by layer.

## Design principles

- **One Terraform state per layer** (`00` → `70`), stored in Azure Blob Storage with Entra ID auth, shared keys disabled, versioning and soft delete.
- **No stored secrets.** GitHub Actions and Azure DevOps authenticate to Azure with workload identity federation (OIDC).
- **Policy as code.** Azure Policy definitions and assignments live in the repository and are applied by pipeline.
- **Controlled promotion.** Pull requests run `plan`; `apply` runs behind a protected environment with required reviewers and per-layer concurrency.
- **Private by default.** Hub and spoke network, private DNS zones and private endpoints for data services.
- **Cost-aware.** The platform is brought up on demand and torn down afterwards; budget alerts are managed in Terraform. See [costs](docs/costs.md).

## Status

| Area | Layers | State |
|---|---|---|
| Remote state, identity without secrets (OIDC) | `00-bootstrap`, `05-identity` | Deployed |
| Hub and spoke network, private DNS, Log Analytics | `10-foundation` | Deployed |
| Governance: Azure Policy as code | `20-governance` | Deployed |
| Private data: SQL and Key Vault | `30-data` | Written, applied on demand |
| AKS, workload identity, Argo CD, Helm, NetworkPolicy | `40-aks`, `gitops/` | Written, applied on demand |
| Edge: Front Door + WAF, DNS, Traffic Manager | `50-edge` | Written, applied on demand |
| Observability: Prometheus, Grafana, Datadog (APM, monitors, SLO as code) | `60-observability`, `70-datadog` | Written, applied on demand |
| Delivery: GitHub Actions and Azure DevOps (PR gates, promotion, approvals) | `.github/`, `pipelines/` | In progress |

Last updated: November 2, 2026.

## Architecture

See [HOW-IT-WORKS](docs/HOW-IT-WORKS.md) for the layer map and [docs/decisions/](docs/decisions/) for the architecture decision records. The path from a feature branch to production is in [E2E-FEATURE-FLOW](docs/E2E-FEATURE-FLOW.md).

## Repository layout

```text
infra/terraform/   layers 00 → 70 (one state per layer)
infra/policies/    Azure Policy rules as JSON (policy as code)
app/               customer-portal: Node.js API + static web
gitops/            Argo CD (app-of-apps), Helm chart, per-environment values, add-ons
observability/     versioned dashboards (Grafana JSON, Datadog template)
pipelines/         Azure DevOps (YAML + templates)
.github/workflows/ GitHub Actions (ci, infra, app)
scripts/           azp.ps1 (lifecycle) and operational scripts
docs/              how it works, walkthroughs, ADRs, game days, costs, runbook
portal/            local tooling: progress tracking and read-only environment checks
```

## Day-to-day commands

```powershell
./scripts/azp.ps1 status                 # what is deployed
./scripts/azp.ps1 up -Through 40-aks     # bring the platform up (layers 05 → 40)
./scripts/bootstrap-gitops.ps1           # Argo CD + app-of-apps
./scripts/azp.ps1 down                   # tear everything down (keeps 00 and 05)
```

## Documentation

- [E2E feature flow: feature branch to production](docs/E2E-FEATURE-FLOW.md)
- [How it works](docs/HOW-IT-WORKS.md) · [Costs and limits](docs/costs.md) · [Runbook](docs/runbook.md)
- [Game days](docs/game-days.md) · [Architecture decision records](docs/decisions/)
- [Step-by-step walkthroughs](docs/labs/) · [Azure DevOps pipelines refresher](docs/azure-devops-refresher.md)
