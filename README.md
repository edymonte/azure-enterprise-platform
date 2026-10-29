# Azure Enterprise Platform — guided lab

A **simulated but real** production platform for the fictional company **Monteiro Financial Services**, built end to end with **Terraform**:

**AKS · GitOps (Argo CD) · Azure Policy · Defender for Cloud · Azure SQL · Key Vault · Private Endpoints · Front Door + WAF · Azure DNS · Traffic Manager · Managed Prometheus/Grafana · Datadog · GitHub Actions · Azure DevOps**

> Start with **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)** — the whole environment explained layer by layer.
>
> Study day to day with the **[local learning portal](portal/README.md)**: `npm --prefix portal start` → <http://127.0.0.1:4317/> — a dated schedule of 30 platform sessions where progress comes from verified evidence.

## Status

This is a personal lab I am building and operating step by step, one session a day. The code for every layer is in the repository; the table shows what is actually deployed and practised so far.

| Area | Layers / sessions | Status |
|---|---|---|
| Remote state, identity without secrets (OIDC) | `00-bootstrap`, `05-identity` | Deployed |
| Hub & spoke network, private DNS zones, Log Analytics | `10-foundation` | Deployed |
| Governance: Azure Policy as code | `20-governance` · session C001 | Deployed and practised |
| Foundation sessions: state, OIDC pipelines, drift, network review, private SQL and Key Vault, DNS | `30-data` · sessions C002–C008 | In progress |
| AKS, workload identity, GitOps with Argo CD, Helm, NetworkPolicy | `40-aks` · sessions C009–C016 | Planned |
| Delivery with GitHub Actions and Azure DevOps: PR gates, promotion, approvals | sessions C017–C024 | Planned |
| Front Door + WAF, Managed Prometheus/Grafana, Datadog, incidents | `50-edge`, `60-observability`, `70-datadog` · sessions C025–C030 | Planned |

Last updated: October 29, 2026.

## How the lab works

It is a **guided lab**. Every phase has the same structure:

| Section | What you do |
|---|---|
| 🎯 Goal | Understand the business requirement and what you will build |
| 🧠 Concepts | Read the minimum you need (Terraform + Azure) |
| 🛠️ Steps | Run the commands, each one explained |
| ✅ Checkpoint | Prove it works, with the expected evidence |
| 💥 Break it | An injected failure to diagnose (Observation → Hypothesis → Test → Evidence) |
| 🎤 Interview | Questions to answer without notes |
| 🏋️ Challenge | *(from phase 04 on)* you write part of the Terraform; the answer is collapsed |

Autonomy grows over time: early phases explain every block; late phases give you the requirement and expect a delivery.

## Roadmap (80/20) and time budget

| Phase | Lab | Layer / folder | Hours |
|---:|---|---|---:|
| 00 | [Prerequisites: tools, trial, domain](docs/labs/00-prerequisites.md) | `config/` | 2 |
| 01 | [Bootstrap and remote state](docs/labs/01-bootstrap-state.md) | `00-bootstrap` | 2 |
| 02 | [Identities and OIDC (no secrets)](docs/labs/02-identity.md) | `05-identity` | 3 |
| 03 | [Hub & spoke network](docs/labs/03-network-foundation.md) | `10-foundation` | 4 |
| 04 | [Governance: Policy and Defender](docs/labs/04-governance.md) | `20-governance` | 4 |
| 05 | [Private data: Key Vault and SQL](docs/labs/05-data.md) | `30-data` | 4 |
| 06 | [Production-grade AKS](docs/labs/06-aks.md) | `40-aks` | 6 |
| 07 | [GitOps with Argo CD + first delivery](docs/labs/07-gitops.md) | `gitops/` | 6 |
| 08 | [CI/CD with GitHub Actions](docs/labs/08-github-actions.md) | `.github/` | 4 |
| 09 | [CI/CD with Azure DevOps](docs/labs/09-azure-devops.md) | `pipelines/` | 5 |
| 10 | [Edge: DNS, Front Door, WAF, Traffic Manager](docs/labs/10-edge.md) | `50-edge` | 5 |
| 11 | [Azure observability: Prometheus, Grafana, alerts](docs/labs/11-azure-observability.md) | `60-observability` | 4 |
| 12 | [Datadog: APM, logs, monitors and SLO as code](docs/labs/12-datadog.md) | `70-datadog` | 5 |
| 13 | [Game days](docs/game-days.md) | everything | 6 |
| 14 | [Portfolio and mock interview](docs/labs/14-portfolio.md) | `docs/` | 2 |
| | **Total** | | **≈ 62 h** |

Suggested pace: 4–5 h/day → about **2.5 weeks**. Create the Datadog trial account (14 days) only when you reach phase 12.

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
docs/              HOW-IT-WORKS, labs, ADRs, game days, costs, runbook, interview prep
portal/            local learning portal (schedule, AZ-400 integration, read-only checkers, progress)
```

## Day-to-day commands

```powershell
./scripts/azp.ps1 status                 # what is deployed
./scripts/azp.ps1 up -Through 40-aks     # bring the platform up (layers 05 → 40)
./scripts/bootstrap-gitops.ps1           # Argo CD + app-of-apps
./scripts/azp.ps1 down                   # tear everything down (keeps 00 and 05)
```

## Documentation

- **[E2E feature flow — feature branch to production](docs/E2E-FEATURE-FLOW.md)**
- [How it works](docs/HOW-IT-WORKS.md) · [Costs and trial limits](docs/costs.md) · [Runbook](docs/runbook.md)
- [Game days](docs/game-days.md) · [Architecture decision records](docs/decisions/)
- [Azure DevOps pipelines refresher](docs/azure-devops-refresher.md)
- [Interview prep pack — Azure DevOps Consultant](docs/interview/README.md) · [7-day personal route](docs/ROUTE-7-DAYS.md)
