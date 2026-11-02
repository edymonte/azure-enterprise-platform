# Learning path — what this lab trains, in what order

This page maps the whole journey through this repository: the order of work, what each step **reinforces** (skills an experienced DevOps engineer already has) and what it **adds** (new skills), plus the evidence that proves each step.

- **Reinforced** = Azure DevOps / GitHub Actions pipelines, Terraform, day-to-day Azure, monitoring tools. You use them here at production depth.
- **Acquired** = what this lab adds on top: platform design, identity without secrets, governance as code, GitOps, private networking, edge, SRE practice and interview narration.

The plan is **30 days, 6 study days per week, ~2 h of attention per day**: Block A lab (45 min), Block B autonomy variation and companion tracks (45 min, see §5), Block C technical English (30 min). Long `terraform apply` runs happen unattended and do not count.

| Repository | Role |
|---|---|
| `azure-enterprise-platform` (this one) | The main lab: one production-shaped platform, built and operated end to end |
| `aws-enterprise-platform` | The AWS twin — same app, chart and docs structure |
| `lab-gitflow` | Companion: Git Flow + centralized deploy in Azure DevOps and GitHub (simulated, zero cost) |

---

## 1. The route at a glance

| Cycle | Week | Focus | Source | Outcome |
|---:|---:|---|---|---|
| 1 | 1 | **Real E2E delivery**: foundation → first deploy → feature to production → quality gates → infra change with approval → Azure DevOps path → mock | [ROUTE-7-DAYS.md](ROUTE-7-DAYS.md), [E2E-FEATURE-FLOW.md](E2E-FEATURE-FLOW.md) | One feature shipped dev → prod through PRs, CI, GitOps and smoke tests; a 2-minute narration of it |
| 2 | 2 | **Operate and break it**: game days, rollback, hotfix | [game-days.md](game-days.md), FEAT-06/07 | Diagnose failures you did not cause, with *Observation → Hypothesis → Test → Evidence* |
| 3 | 3 | **Edge and observability**: Front Door + WAF, DNS, Traffic Manager DR; Managed Prometheus/Grafana, alerts, KQL | labs [10](labs/10-edge.md), [11](labs/11-azure-observability.md) | Public HTTPS entry point protected by WAF; dashboards and alerts that fire |
| 4 | 4 | **Governance and third-party observability**: Policy `Deny` exercises, Defender, Datadog APM/logs/SLOs as code | labs [04](labs/04-governance.md), [12](labs/12-datadog.md) | Guardrails that block, not only audit; SLOs defined in Terraform |
| Close | 5 (2 days) | **Portfolio, mock interviews, teardown** | [labs/14](labs/14-portfolio.md), [interview/](interview/README.md) | Two mock scenarios at ≥ 8/10; platform destroyed except `00` and `05` |

Re-plan rule: a failed success criterion moves to the first slot of the next day. A cycle never closes on "it should work" — only on evidence.

---

## 2. Phase by phase

### Phase 00–01 — Prerequisites, bootstrap and remote state (`config/`, `00-bootstrap`)

| Reinforced | Acquired |
|---|---|
| Terraform init/plan/apply, Azure CLI, subscriptions | **Resource provider registration** (subscription-level opt-in, `*/register/action`) |
| Remote state in a storage account | State storage with **shared keys disabled** → Entra ID only (`use_azuread_auth`) |
| Budgets | **Control plane vs data plane** (Owner ≠ Storage Blob Data Contributor) |
| | The bootstrap chicken-and-egg problem (local state for the layer that creates remote state) |
| | DNS delegation from the registrar to Azure DNS; why the zone lives in the bootstrap layer |

Evidence: `az storage blob list --auth-mode login` works without a key; `Resolve-DnsName -Type NS` returns `azure-dns` servers.

### Phase 02 — Identity and OIDC (`05-identity`)

| Reinforced | Acquired |
|---|---|
| Service principals, RBAC roles | **Workload identity federation**: federated credentials per subject (`pull_request`, `ref:refs/heads/main`, `environment:lab`) |
| GitHub environments and reviewers | Pipelines with **zero secrets** — only non-sensitive variables |
| | Pragmatic least privilege (Contributor + RBAC Admin + Policy Contributor + Security Admin) and its limits |
| | Design gaps to discuss: plan/apply identity split, environment branch policies |

Evidence: role assignments listed per scope; `Client secrets` empty; repo variables + `lab` environment.

### Phase 03 — Hub & spoke network (`10-foundation`)

| Reinforced | Acquired |
|---|---|
| VNets, subnets, NSGs | Hub & spoke with **bidirectional, non-transitive peering** |
| Log Analytics | **Private DNS zones** linked to both VNets (the base for private endpoints) |
| | NSG layering by priority: allow specific → deny broad; service tags |
| | Cost guardrails in code (`daily_quota_gb`) |

### Phase 04 — Governance: Policy and Defender (`20-governance`)

| Reinforced | Acquired |
|---|---|
| Azure Policy assignments | **Policy as code**: rules in `infra/policies/*.json`, initiatives, parameters |
| | Policy language depth: `field` vs `value` vs `count`, `current()`, the `field()` function |
| | Safe rollout: `Audit` → measure → `Deny`; exclusions (e.g. `MC_*`) |
| | Why `terraform validate` cannot catch policy semantics — the API validates on PUT |
| | Defender for Cloud plans and their cost/trial lifecycle |

### Phase 05 — Private data: Key Vault and SQL (`30-data`)

| Reinforced | Acquired |
|---|---|
| Key Vault, Azure SQL | **Private endpoints** + private DNS resolution end to end |
| | **Entra-only SQL authentication** with an admin group; managed identity as a database user |
| | RBAC propagation delays as a troubleshooting hypothesis |
| | Conflict between operator access (firewall rule) and a "no public network" guardrail |

### Phase 06 — Production-grade AKS (`40-aks`)

| Reinforced | Acquired |
|---|---|
| Kubernetes workloads, `kubectl` | AKS with **Entra ID + Azure RBAC**, **workload identity**, API server IP allowlist |
| Container registries | Managed Prometheus wiring, Key Vault CSI driver |
| | Capacity planning under quota (4 vCPU, upgrade surge) |
| | Cost control: `az aks stop/start` vs destroy |

### Phase 07 — GitOps with Argo CD (`gitops/`)

| Reinforced | Acquired |
|---|---|
| Helm charts | **Argo CD app-of-apps**, sync status vs health |
| | **PostSync smoke Job** as the deploy gate |
| | "Git wins": no `kubectl edit`, no `rollout undo` — revert the commit |
| | Environment values per namespace (dev/prod, later qa) |

### Phase 08–09 — CI/CD with GitHub Actions and Azure DevOps (`.github/`, `pipelines/`)

| Reinforced | Acquired |
|---|---|
| Workflows, YAML pipelines, environments, approvals | **CI opens PRs, never deploys** (ADR-0003) |
| Service connections | Manual **WIF service connection** in Azure DevOps |
| | Build once, promote the same image (tag → digest discussion) |
| | Required checks + protected `main` + PR tokens that trigger checks |
| | GitHub vs Azure DevOps side by side: triggers, identity, approvals |

### Phase 10 — Edge (`50-edge`)

| Reinforced | Acquired |
|---|---|
| DNS records | **Front Door + WAF** in front of AKS; origin lock-down |
| | Traffic Manager for regional DR; managed TLS |
| | WAF false positives and exclusions (GD-09) |

### Phase 11–12 — Observability (`60-observability`, `70-datadog`)

| Reinforced | Acquired |
|---|---|
| Datadog / Dynatrace dashboards and monitors | Managed Prometheus + Managed Grafana; Prometheus alert rules → action group |
| | KQL in Log Analytics |
| | **Datadog as code**: monitors and SLOs in Terraform; dual observability trade-offs (ADR-0006) |

### Phase 13 — Game days

GD-01 … GD-09 ([game-days.md](game-days.md)): errors, latency, a deploy that never went live, broken DB connectivity, pipeline auth failure, exposed SQL, manual scaling drift, region down, WAF blocking customers.

**Acquired:** troubleshooting under pressure, writing the hypothesis before acting, incident narration.

### Phase 14 — Portfolio and mock interview

**Acquired:** the 2-minute E2E pitch, consultant-shaped answers, ADRs as interview material ([decisions/](decisions/README.md)).

---

## 3. E2E tickets (cycle 1, repeated in later cycles)

| Ticket | Scenario | What it trains |
|---|---|---|
| FEAT-01 | New endpoint, dev → prod | The full standard loop |
| FEAT-02 | UI change (both images) | Multi-image builds |
| FEAT-03 | Bug caught before `main` | CI as a quality gate |
| FEAT-04 | Bad release caught in dev by smoke | Unit vs smoke vs integration tests; revert the deploy PR |
| FEAT-05 | `portal-qa` via Terraform + GitOps | Plan comment, approval, pipeline apply |
| FEAT-06 | Production hotfix | Hotfix flow without bypassing gates |
| FEAT-07 | Rollback drill | Git revert as rollback |
| FEAT-08 | Same feature through Azure DevOps | Second CI/CD platform |

---

## 4. Cross-cutting skills (every session)

| Skill | How it is trained |
|---|---|
| **Troubleshooting method** | Every failure goes *Observation → Hypothesis → Test → Evidence* before the fix |
| **Reading plans** | No `y` without checking the `Plan:` line and the risky attributes |
| **Change discipline** | Branch → PR → required checks → squash merge; no direct push to `main` |
| **Cost awareness** | Stop AKS overnight, track trials (subscription credit, Defender plans), `down` at the end |
| **Technical English** | First pass: model answer is given. From the second pass on: you explain, and the English review happens in a dedicated block at the end of the session |
| **Trade-offs** | Every design choice is explained as *what we chose, what we gave up, when we would choose differently* |

### Real findings so far (the best interview stories)

| Finding | Lesson |
|---|---|
| `az vm list-usage` returned nothing on a new subscription | `Microsoft.Compute` was not registered; registration is per subscription |
| First `terraform plan` sat silent for minutes | The azurerm provider registers its default resource providers on first use |
| `-chdir` received the whole `terraform init` output | PowerShell returns *everything* written to the success pipeline from a function |
| Garbled box characters after the fix | Piping native output through PowerShell decodes it with the console code page |
| `az ad group member list` hid the pipeline's service principal | Verify with Microsoft Graph (`/members/microsoft.graph.servicePrincipal`) before concluding |
| Policy rejected with `UnsupportedPolicyRuleField` | `field` cannot use `current()`; CI cannot validate policy semantics |

---

## 5. Companion tracks (Block B)

The main lab is one deep, integrated system. Block B adds short, focused practice around it. Three companion tracks, in priority order:

### 5.1 `lab-gitflow` — Git Flow + centralized deploy (Azure DevOps and GitHub)

A separate repository on purpose: its lesson **is** the multi-repo, multi-project setup (3 Azure DevOps projects, 4 repos, cross-project templates and pipeline resources). It deploys in **simulated** mode, so it costs nothing.

| Reinforced | Acquired |
|---|---|
| YAML pipelines, environments, approvals | **Pipeline resources across projects** and routing by `RESOURCES_*` variables |
| Branch policies, build validation | **Git Flow → environment mapping** (`develop` → DEV, `release/*`/`hotfix/*` → HML, `main` → PRD) |
| Step and stage templates | Stage-level `condition` so environment approvals are only requested when needed |
| | **Versioned templates** (`ref: refs/tags/v1.0.0`, the ADO equivalent of `uses: …@v1`) |
| | App catalog: a new app = one resource + one catalog line |
| | Cross-project permission troubleshooting (job authorization scope, Build Service identities) |
| | The same design in GitHub (reusable workflows) and a side-by-side comparison |

| Week | Missions | Connects to |
|---:|---|---|
| 1 | 0–7 (setup, CI, central CD, chain trigger, release + approval, branch policy, template versioning) | Day 6 — FEAT-08 / lab 09 (Azure DevOps path) |
| 2 | 8–10 (hotfix, second app, GitHub version) | FEAT-06 (hotfix), ADR-0003 |
| optional | 11 (real Web App deploy) | Create it with Terraform and destroy it the same day |

**Contrast it with this repository — a classic interview question:**

| | `lab-gitflow` | `azure-enterprise-platform` |
|---|---|---|
| Branching | Git Flow (long-lived `develop`, `release/*`, `hotfix/*`) | Trunk-based (`main` + short-lived branches) |
| Deployment | **Push**: a central pipeline deploys | **Pull**: CI opens a GitOps PR, Argo CD applies |
| Environment selection | Source branch of the artifact | Folder/values per environment in Git |
| Rollback | Re-run an older pipeline resource run | Revert the GitOps commit |

> *"When would you choose Git Flow with push deployments over trunk-based with GitOps?"* — scheduled releases, regulated sign-offs and several versions in parallel favour Git Flow; continuous delivery, small batches and drift control favour trunk-based + GitOps.

### 5.2 Daily challenges (in design)

A KodeKloud-style track built **on this platform**: one short, scenario-based task per day with a success criterion, an automated checker, graduated hints and a collapsed solution, done solo. Its design is being drafted — it will be linked here once the first tasks exist.

### 5.3 External sandbox practice

One generalist DevOps track on an external sandbox platform (15–20 min) for fundamentals this lab touches lightly: Linux administration, Git, Docker, Kubernetes primitives, Jenkins, Ansible. Pick **one** track, not several in parallel, and prefer tasks that connect to the current lab day (e.g. pod resource limits before the AKS day).

**Block B rule:** the main lab always wins. On a troubleshooting-heavy day, Block B is skipped; on a day with a long unattended `apply`, Block B fills the wait.

---

## 6. Readiness rubric

Score each scenario (mock answer, game day, ticket) from 0 to 2 on five criteria — 10 points in total:

| Criterion | 0 | 1 | 2 |
|---|---|---|---|
| Technical correctness | Wrong | Partly right | Right and precise |
| Autonomy / reasoning | Needed the solution | Needed hints | Solved alone |
| Investigation / validation | No evidence | Some evidence | Hypothesis tested and proven |
| English clarity | Hard to follow | Understandable | Clear and structured |
| Trade-offs | None | Mentioned | Explained with alternatives |

**Readiness signal:** 8/10 in two different scenarios, with no zero in correctness or English. It is a signal, never a guarantee. Record solo and assisted attempts separately.
