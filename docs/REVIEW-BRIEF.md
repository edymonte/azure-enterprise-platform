# Review brief — Azure Enterprise Platform lab

> **For the reviewer (human or LLM):** this document is self-contained. It describes a hands-on lab that has been **written and statically validated but not yet deployed**. Please review it critically: correctness, security, cost, feasibility on a 30-day Azure trial, and whether it is a good preparation for an **Azure DevOps Consultant** interview at an international company. Specific questions are in section 11.

---

## 1. Context and goals

| Item | Detail |
|---|---|
| Learner | DevOps engineer (Azure DevOps, GitHub Actions — GH-200 certified, Terraform, Datadog/Dynatrace). Preparing for an English-language interview for an **Azure DevOps Consultant** role and for international roles in general. |
| Goal | Practice a realistic, production-shaped Azure platform end to end, with **Terraform** as the main tool, and be able to explain every decision in English. |
| Format | Guided lab: 15 phases, ≈ 62 h. Each phase: Goal → Concepts → Steps → Checkpoint → "Break it" (failure injection) → Interview questions → Challenge (from phase 04, answer collapsed). |
| Scenario | Fictional company **Monteiro Financial Services (MFS)** publishing a **Customer Portal** (Node.js API + static web). |
| Language | Repository 100% English. |
| Constraints | Azure **30-day trial** subscription (≈ US$200 credit, typically 4 vCPU regional quota), personal domain **edymonte.com.br** (DNS currently at Registro.br, no records in use), Datadog trial (14 days) only in phase 12, Windows + PowerShell 7 workstation. |
| Status | Code complete. `terraform validate` passes on all 9 layers with Terraform 1.12.2 and 1.15.7; Helm chart lints; API unit tests pass; YAML parses. **Nothing applied to Azure yet.** |

## 2. Business requirements → platform answer

| # | Requirement | Implementation |
|---|---|---|
| 1 | Custom domain, HTTPS, web-attack protection | Azure DNS + Front Door Premium + WAF |
| 2 | No database or secret exposed publicly | Private Endpoints + private DNS, Key Vault, Workload Identity, Entra-only Azure SQL |
| 3 | No manual cluster access for deployments | GitOps with Argo CD; pipelines only push images and open PRs |
| 4 | Auditable compliance | Azure Policy initiative (custom + built-in) + AKS pod security baseline + Defender for Cloud |
| 5 | Detect problems before customers | Managed Prometheus + Managed Grafana + Container Insights + Datadog APM; SLO-based alerts |
| 6 | Tested contingency | Traffic Manager DR lab (DNS failover) + 9 game days |
| 7 | Two CI/CD tools | Equivalent pipelines in GitHub Actions and Azure DevOps, both secretless (OIDC / workload identity federation) |

## 3. Architecture

```
Internet → Azure DNS (edymonte.com.br) → Front Door Premium + WAF (TLS ends here, managed certs)
        → static Public IP of a dedicated NGINX ingress (AKS app-routing add-on)
          NSG on AKS subnet: 80/443 only from service tag AzureFrontDoor.Backend (+ operator IP)
        → AKS (spoke VNet 10.60.0.0/16, Azure CNI Overlay + Cilium, Entra ID + Azure RBAC, local accounts off)
            namespaces portal-dev / portal-prod, NetworkPolicy, HPA, PDB
        → Azure SQL (Entra-only auth, private endpoint) and Key Vault (RBAC, firewall + private endpoint)
          via Workload Identity (federated credential per namespace) — no passwords
Hub VNet 10.50.0.0/16: private DNS zones (vaultcore, database), Log Analytics, Azure Monitor workspace
Observability: Container Insights (DCR), Managed Prometheus (DCR + DCE), PromQL alert rules → Action Group,
               Managed Grafana; Datadog Operator/Agent + APM (dd-trace)
Delivery: GitHub Actions / Azure DevOps → build, Trivy scan, push to ACR → PR bumping image tag → Argo CD sync
```

## 4. Terraform design

- **Layered root modules**, one state blob per layer, in one storage account. Layers share data via `terraform_remote_state` (output contracts).
- **Partial backend** (`backend "azurerm" {}`), completed at `init` with a generated `backend.hcl` + `key=<layer>.tfstate`. State storage uses Entra ID auth only (shared keys disabled), versioning, soft delete.
- Providers: `azurerm ~> 4.40`, `azuread ~> 3.4`, `random ~> 3.7`, `DataDog/datadog ~> 3.60`. Terraform `>= 1.12.2, < 2.0.0`.
- A stable `name_suffix` is generated once in `00-bootstrap` and reused by all layers, so globally unique names (ACR, Key Vault, SQL, ingress DNS label) survive the **daily destroy/recreate** cycle used for cost control.
- Lifecycle script `scripts/azp.ps1` (`bootstrap`, `plan`, `apply`, `destroy`, `up -Through`, `down`, `status`) prints every Terraform command it runs, for learning.
- No secret values ever managed by Terraform (no `azurerm_key_vault_secret`); secret values written out-of-band.

### Layers and what each one creates

| Layer | Resources | Notes |
|---|---|---|
| `00-bootstrap` (local state) | RG + storage account + container for state; role assignment *Storage Blob Data Contributor*; **public DNS zone** `edymonte.com.br`; subscription **budget** (50/80% actual, 100% forecast); `random_string` suffix | Long-lived. DNS zone here so name servers stay stable for the Registro.br delegation. |
| `05-identity` | Entra **app + SP for GitHub Actions** with 3 federated credentials (`pull_request`, `ref:refs/heads/main`, `environment:lab`); optional **app for Azure DevOps** (manual WIF: issuer/subject variables); subscription roles for pipelines: Contributor, Role Based Access Control Administrator, Resource Policy Contributor, Security Admin (via `setproduct`); state access; **Entra group** `grp-mfs-sql-admins` (user + pipelines) | Long-lived; free. |
| `10-foundation` | Hub and spoke RGs/VNets, subnets (`snet-aks` /22, `snet-private-endpoints` /24), bidirectional peering, NSG on AKS subnet (allow AzureFrontDoor.Backend 100, operator IP 110, deny Internet 4000), private DNS zones `privatelink.vaultcore.azure.net` and `privatelink.database.windows.net` linked to both VNets, Log Analytics (daily cap 1 GB), Azure Monitor workspace, Action Group (e-mail) | `operator_ip_ranges` validated (no 0.0.0.0/0). |
| `20-governance` | 2 custom policy definitions loaded with `file()` (RG mandatory tags via `count` over a parameter array, excluding `MC_*`, `NetworkWatcherRG`, `DefaultResourceGroup-*`; SQL public network access must be Disabled); **initiative** with these + built-in *Allowed locations*; subscription assignment with parameter `guardrailEffect` (Audit default, Deny in exercises); built-in initiative **AKS pod security baseline (Linux)** assigned in audit; Defender plans `Containers`, `KeyVaults`, `SqlServers` (Standard); security contact | Allowed locations: eastus2 + brazilsouth (DR lab). |
| `30-data` | Key Vault (RBAC, purge protection off for lab, firewall default Deny + operator IPs, bypass AzureServices) + private endpoint; Azure SQL server (TLS 1.2, Entra-only auth with admin = group from `05-identity`, public access off unless `sql_temporary_public_access=true` which also creates firewall rules for operator IPs) + `portal` database (Basic, LRS backup, 7-day PITR) + private endpoint | Temporary public access is used once by a script to create the contained DB user. |
| `40-aks` | ACR Basic (admin off); AKS (Free tier, auto-upgrade `patch`, node OS `NodeImage`, OIDC issuer + Workload Identity, local accounts disabled, Azure RBAC, authorized IP ranges, CNI Overlay + Cilium dataplane/policy, Key Vault CSI with rotation, web app routing add-on, OMS agent with MSI auth, `monitor_metrics`, optional Defender sensor, system pool D2s_v5 autoscale 1–2, optional user pool); role assignments (AcrPull to kubelet, Network Contributor on spoke RG to cluster identity, RBAC Cluster Admin + Cluster User to admins); **static public IP** with DNS label for the ingress; user-assigned identity for the API + federated credentials (`for_each` over namespaces) + *Key Vault Secrets User*; DCR/DCRA for Container Insights; DCE + DCR + 2 associations for Managed Prometheus; **Prometheus rule group** (error ratio > 5%, p95 > 500 ms, restarts > 3/15 min) → Action Group | `lifecycle.ignore_changes` on `kubernetes_version` and node count. |
| `50-edge` | Edge RG; Front Door profile (Premium default), endpoint, origin group (no health probe, single origin), origin = ingress PIP FQDN (Host header forwarded), custom domains `portal` and `portal-dev` with managed certs, `_dnsauth` TXT validation records, route (HTTP→HTTPS redirect, `HttpOnly` to origin), domain associations, CNAMEs; **WAF policy** (mode Detection default, custom rate-limit rule, DefaultRuleSet 2.1 + BotManager 1.1 when Premium); security policy on endpoint + domains. **Optional DR lab:** 2 Azure Container Instances (eastus2 + brazilsouth, `aci-helloworld`), Traffic Manager profile (Priority routing, HTTP probe), external endpoints, CNAME `portal-dr` | Most expensive layer; applied only in phase 10. |
| `60-observability` | Azure Managed Grafana (Standard, major version 11, system identity, AMW integration), roles Monitoring Data Reader (AMW) + Monitoring Reader (subscription) to Grafana identity, Grafana Admin to operators | Dashboards imported from JSON by script. |
| `70-datadog` | Datadog monitors (APM error rate, p95 latency, pod restarts), SLO (good/total requests over 7 days), dashboard via `templatefile()` | Credentials from env vars only. |

## 5. Application and GitOps

- **API** (Node.js 24, Express): `/healthz`, `/readyz` (DB ping), `/api/info`, `/api/products`, `/metrics` (prom-client RED metrics). Azure SQL via `mssql`/tedious with `azure-active-directory-default` (Workload Identity). Banner read from a Key Vault secret mounted by CSI. **Chaos switches** via env (`CHAOS_ERROR_RATE`, `CHAOS_LATENCY_MS`) driven by Helm values through Git. Optional `dd-trace`. Non-root image (UID 1000), read-only root FS.
- **Web**: static HTML on `nginx-unprivileged`.
- **Helm chart** (one for all envs): ServiceAccount (WI annotation), Deployments, Services, Ingress (host-based), HPA, PDB, SecretProviderClass, `PodMonitor` (`azmonitoring.coreos.com/v1`), NetworkPolicy (allow from `app-routing-system`, `kube-system`, `datadog`).
- **Argo CD** installed once with Helm; app-of-apps (`root` → `platform-ingress`, `portal-dev`, `portal-prod`; Datadog apps kept in an `addons/` folder until phase 12). Auto-sync with prune + selfHeal.
- **Terraform → GitOps bridge:** a script renders `gitops/envs/<env>/platform.values.yaml` from Terraform outputs; committed through a PR.
- **Datadog**: Operator + `DatadogAgent` CR via Argo CD; API key stored in Key Vault, copied into a K8s Secret by script; app sends traces to the node-local agent Service (`datadog-agent.datadog.svc`) instead of hostPort/hostIP to stay compliant with the pod security baseline.

## 6. CI/CD

| Pipeline | GitHub Actions | Azure DevOps |
|---|---|---|
| Quality gate | `ci.yml`: fmt/validate × 9 layers, `npm test`, `helm lint`, Trivy config scan (report-only), secret grep | — |
| Infra | `infra.yml`: PR → plan matrix + PR comment (OIDC subject `pull_request`, `-lock=false`); manual → plan/apply/destroy one layer with `environment: lab` approval | `infra.yml`: Validate → Plan → Apply (deployment job on environment `mfs-lab`); auth via `AzureCLI@2` + `addSpnToEnvironment` → `ARM_OIDC_TOKEN`; step template |
| App | `app.yml`: test → docker build → Trivy (fail on CRITICAL) → push ACR → `peter-evans/create-pull-request` bumping dev tag; manual promotion PR to prod | `app.yml`: same, GitOps PR to GitHub via a PAT stored in Key Vault–linked variable group |

## 7. Lab plan (≈ 62 h)

| Phase | Topic | Hours |
|---|---|---|
| 00 | Tools, trial, providers registration, quotas, repo, settings | 2 |
| 01 | Bootstrap, remote state, Registro.br → Azure DNS delegation | 2 |
| 02 | Identities & OIDC, GitHub variables/environment via `gh` | 3 |
| 03 | Hub & spoke, `cidrsubnet`, drift exercise | 4 |
| 04 | Policy (Audit → Deny), Defender | 4 |
| 05 | Key Vault, SQL, private endpoint DNS | 4 |
| 06 | AKS deep dive | 6 |
| 07 | GitOps, first delivery, SQL contained user, Argo CD | 6 |
| 08 | GitHub Actions | 4 |
| 09 | Azure DevOps (manual WIF service connection, variable groups, environments) | 5 |
| 10 | Front Door, WAF Detection→Prevention, Traffic Manager DR | 5 |
| 11 | Grafana, KQL, SLO alerts via chaos PR | 4 |
| 12 | Datadog APM, monitors/SLO as code | 5 |
| 13 | 9 game days (chaos, bad tag, private DNS link deleted, OIDC subject mismatch, SQL exposed, manual scale, region down, WAF false positives) | 6 |
| 14 | Portfolio, mock interview | 2 |

An **interview prep pack** (`docs/interview/`) adds: 30 s / 2 min pitch, ~40 technical Q&A, consultant scenarios with STAR templates, and an English phrase bank (false friends for Portuguese speakers).

## 8. Cost model (estimates, unverified)

Daily cycle: `up` 05→40 in the morning, `down` at night; 00 and 05 stay. Largest costs: AKS nodes (2 × D2s_v5), **Front Door Premium** (hourly base fee — only during phase 10), Managed Grafana (phases 11–13). Log Analytics capped at 1 GB/day. Defender plans used within 30-day trials. Budget alerts at 50/80/100%.

## 9. Known trade-offs (documented as ADRs)

1. Layered state with remote_state coupling (cascade re-apply when upstream outputs change).
2. Argo CD instead of Flux extension.
3. CI opens PRs, never deploys.
4. ACR **Basic** with public endpoint (Premium needed for private endpoint).
5. Front Door → **public** origin restricted by NSG service tag; origin hop is HTTP; X-Azure-FDID validation left as a challenge; Private Link is the production answer.
6. Two observability stacks (Azure-native + Datadog).
7. One AKS cluster with dev/prod as namespaces (quota/cost).
8. Key Vault public network access enabled but firewall-restricted to operator IP (so secrets can be written from the laptop).
9. SQL contained user is created by temporarily enabling public access for the operator IP (policy flags it — used as a lesson).

## 10. Unverified assumptions / risks I am least sure about

1. **Trial quotas/offers**: 4 vCPU regional limit; whether Front Door Premium, Managed Grafana, Defender plans and consumption budgets are all allowed on a Free Trial subscription.
2. **Custom policy** `require-rg-tags`: `count` over `value: [parameters('tagNames')]` with `field: concat('tags[', current('tagName'), ']')` inside `where` — valid syntax? Does excluding `MC_*` etc. suffice so AKS never gets blocked under Deny?
3. **AKS add-on interplay**: `web_app_routing` + a custom `NginxIngressController` CR with `service.beta.kubernetes.io/azure-pip-name` and `azure-load-balancer-resource-group` annotations pointing to a PIP in the spoke RG (cluster identity has Network Contributor there). Will it bind the static IP?
4. **Front Door origin without health probe** and origin host = PIP FQDN with Host header forwarding; certificate issuance timing; whether a security policy may include both the endpoint and custom domains.
5. **Container Insights DCR** stream `Microsoft-ContainerInsights-Group-Default` + `extension_json` settings; Prometheus DCRA naming `configurationAccessEndpoint`.
6. **Azure DevOps + Terraform OIDC**: `AzureCLI@2` `idToken` lifetime vs long `terraform apply` for AKS (~15 min); whether the azurerm backend accepts `ARM_OIDC_TOKEN` in this flow.
7. **Workload Identity + tedious**: `azure-active-directory-default` with `clientId` picks up the projected token correctly.
8. **Datadog Agent on AKS**: `kubelet.tlsVerify: false` and the node-local Service name `datadog-agent` created by the Operator.
9. **Pipeline RBAC**: `Role Based Access Control Administrator` without conditions is effectively privilege-escalation capable — acceptable for a lab?
10. **Interview fit**: is ~62 h too much before an interview "in a few days"? (A 3-day fast-track using only the interview pack + HOW-IT-WORKS is offered.)

## 11. Questions for the reviewer

1. Are there **security flaws** in the design (identity, network exposure, secrets, RBAC scopes)?
2. Which Terraform resources/arguments are likely to **fail at apply time** (not caught by `validate`)? Focus on items in section 10.
3. Is the **cost** model realistic for a 30-day trial? What would you turn off or change?
4. Is the **phase order** right? Anything missing that an Azure DevOps Consultant interview typically covers (e.g. Azure Landing Zones/CAF, Bicep, Azure Boards, release strategies, AKS upgrades, private clusters, App Service/Functions)?
5. Are the **failure-injection exercises** realistic and educational?
6. What would you **remove** to keep the 80/20 focus?
7. Give an overall rating (1–10) for: technical correctness, security, learning value, interview relevance — with one sentence of justification each.
