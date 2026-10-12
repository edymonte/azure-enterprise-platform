# Technical questions — model answers

How to use: cover the answer, say yours **out loud**, then compare. Aim for **30–60 seconds** per answer. The *"In this lab"* lines give you a concrete example to mention.

---

## A. Terraform / IaC

**1. What is Terraform state and why does it matter?**
State maps the resources in your code to real resource IDs. Terraform uses it to compute the diff on `plan`. It must be remote (shared), locked (no concurrent applies) and protected, because it can contain sensitive values.
*In this lab:* one blob per layer in a storage account with versioning, Entra ID auth only, shared keys disabled.

**2. How does state locking work on Azure?**
The azurerm backend takes a **blob lease** on the state file during operations that write state. A second `apply` fails with a lock error. If a run crashes, you can release it with `terraform force-unlock <id>` — only after confirming nobody else is running.

**3. How do you structure Terraform for a large environment?**
Split by lifecycle and ownership: separate root modules (layers or stacks) with their own state — e.g. identity, network, governance, data, compute, edge — and reusable child modules for repeated patterns. Layers share data through outputs (`terraform_remote_state`) or data sources. Environments are separated by state + variables, not by copy-pasting code.

**4. `count` vs `for_each`?**
`count` addresses by index, so removing an item in the middle shifts indexes and recreates resources. `for_each` addresses by key, so changes are stable. I use `count` only for on/off toggles (`count = var.enabled ? 1 : 0`).

**5. What is drift and how do you handle it?**
Drift is when real infrastructure differs from state/code, usually from portal changes. `plan` refreshes and shows it. I handle it by: scheduled plans in CI to detect it, fixing through code (never through the portal), and Azure Policy / RBAC to reduce manual changes.

**6. How do you bring existing resources under Terraform?**
`import` blocks (Terraform 1.5+) with `terraform plan -generate-config-out` to draft the code, then refine and plan until it shows no changes. For renames/refactors, `moved` blocks avoid destroy/recreate.

**7. How do you keep secrets out of Terraform?**
Don't create secret values with Terraform (`azurerm_key_vault_secret` stores the value in state). Prefer identities without secrets (managed identity, OIDC). When unavoidable, mark variables `sensitive` and protect the state like a secret.
*In this lab:* zero secret values in state; Key Vault values are written out-of-band.

**8. How do you test/validate Terraform in CI?**
`fmt -check`, `validate`, a linter (TFLint), a security scanner (Trivy/Checkov), `plan` on every PR with the plan posted for review, and `apply` only from the main branch with an approval gate. For modules: `terraform test`.

**9. How do you manage provider and module versions?**
Pin with pessimistic constraints (`~> 4.40`), commit `.terraform.lock.hcl` in real projects, and upgrade deliberately through a PR with a plan review.

---

## B. CI/CD — Azure DevOps and GitHub Actions

**10. Walk me through creating an Azure DevOps YAML pipeline for Terraform.**
(1) Service connection to Azure using **workload identity federation**; (2) variable group for non-secret settings, linked to Key Vault for secrets; (3) environment with **approvals and checks**; (4) YAML with stages *Validate → Plan → Apply*, where Apply is a **deployment job** targeting the environment; (5) reusable **templates** for the Terraform steps; (6) branch policy on `main` requiring the PR build to pass.
*In this lab:* `pipelines/azure-devops/infra.yml` + `templates/terraform-layer.yml`.

**11. Stages, jobs, steps — and what is a deployment job?**
A stage is a logical phase (build, deploy to dev), a job runs on one agent, steps are tasks/scripts. A **deployment job** targets an **environment**, so it inherits its approvals/checks and records deployment history.

**12. How do you authenticate a pipeline to Azure without secrets?**
OIDC / workload identity federation: the pipeline gets a short-lived token from its issuer (GitHub or Azure DevOps); Entra ID validates issuer + subject against a federated credential on an app registration or managed identity, and returns an access token. Nothing to rotate, nothing to leak.

**13. Templates vs `extends` in Azure DevOps?**
Templates reuse steps/jobs/stages. `extends` templates go further: the pipeline must extend an approved template, which lets a platform team **enforce** required steps (security scan, approvals) — combined with the "required template" check on environments or service connections.

**14. Variables: compile time vs runtime?**
`${{ }}` is template (compile-time) expansion, `$( )` is macro (runtime) syntax, `$[ ]` is runtime expressions. Some things — like the service connection of a task, or conditional template insertion — must be known at compile time.

**15. GitHub Actions vs Azure DevOps — how do you advise a client?**
If the code is already on GitHub and they want one platform, GitHub Actions. Azure DevOps still shines with Boards, classic release governance, multi-stage environments with rich checks, and large enterprises already standardized on it. Both support OIDC to Azure, templates/reusable workflows and approvals. The decision is mostly about where the code and the teams already are, not features.

**16. How do you design a release strategy for multiple environments?**
Build once, deploy many: the same artifact (image digest) is promoted dev → test → prod; config per environment; approvals before prod; automated smoke tests after each deploy; quick rollback path.
*In this lab:* promotion is a PR copying the dev image tag to prod; rollback is `git revert`.

**17. What is GitOps and when would you not use it?**
The desired cluster state is declared in Git and an in-cluster agent (Argo CD/Flux) continuously reconciles it — pull-based, auditable, self-healing. I would not force it for simple PaaS apps (App Service, Functions) where a pipeline deploy is simpler, or for teams without Git maturity.

---

## C. AKS / containers

**18. How do you secure an AKS cluster?**
Identity: Entra ID integration + Azure RBAC, local accounts disabled. Network: private cluster or authorized IP ranges, network policies, controlled egress. Workloads: Workload Identity (no secrets), pod security via Azure Policy (Gatekeeper), images from a private ACR scanned in CI, Defender for Containers. Operations: automatic patch upgrades, node image upgrades, separate system/user pools.

**19. Explain Workload Identity.**
The cluster exposes an OIDC issuer. A pod's service account token is exchanged with Entra ID for an access token of a managed identity, through a federated credential that matches the issuer and `system:serviceaccount:<ns>:<sa>`. The SDK (`DefaultAzureCredential`) does it automatically. It replaced AAD Pod Identity.

**20. Azure CNI vs CNI Overlay vs kubenet?**
Classic Azure CNI gives pods VNet IPs (direct routing, but consumes many IPs). **Overlay** gives pods IPs from a separate CIDR, so the VNet only needs node IPs — today's default recommendation. Kubenet is legacy. Cilium as the dataplane adds eBPF networking and network policy.

**21. How do you handle AKS upgrades?**
Auto-upgrade channel `patch` for security fixes and node OS image channel; minor versions upgraded deliberately: test in a lower environment, check deprecated APIs, use surge settings and PodDisruptionBudgets, upgrade control plane then node pools, have a rollback plan (blue/green node pools for risky changes).

**22. How do you manage secrets in AKS?**
Key Vault + Secrets Store CSI driver, authenticated with Workload Identity, mounted as files (optionally synced to Kubernetes Secrets), with rotation enabled.

**23. A pod is in CrashLoopBackOff. Walk me through it.**
`kubectl describe pod` (events, last state, exit code) → `kubectl logs --previous` → check probes (a liveness probe that is too aggressive kills healthy pods), resources (OOMKilled = exit 137), config/secrets mounts, image tag. Then hypothesis, one change, verify.

**24. HPA vs cluster autoscaler?**
HPA adds pods based on metrics (CPU, custom). Cluster autoscaler adds nodes when pods are Pending due to lack of resources. They work together; requests must be set correctly for both to behave.

---

## D. Networking

**25. Private endpoint vs service endpoint?**
A private endpoint gives the PaaS service a private IP in your VNet and lets you disable public access completely; it works across peering/VPN. A service endpoint keeps the public IP but restricts access to your subnet through the Azure backbone. Private endpoint is the enterprise default.

**26. Why do private endpoints usually "break DNS", and how do you fix it?**
The public name resolves via a CNAME to `privatelink.<service>`. Clients must resolve that zone to the private IP, so you need **private DNS zones linked to every VNet that resolves the name**, and for on-premises, a DNS forwarder / Azure DNS Private Resolver. Most private endpoint incidents are DNS.

**27. Front Door vs Application Gateway vs Traffic Manager vs Load Balancer?**
Front Door: global, layer 7, CDN + WAF, anycast — for public HTTP apps across regions. Application Gateway: regional layer 7 with WAF, inside a VNet. Traffic Manager: DNS-based routing, any protocol, no proxying. Load Balancer: regional layer 4. They are often combined (e.g. Front Door → App Gateway → AKS).

**28. Hub and spoke — what goes in the hub?**
Shared connectivity and security: firewall/NVA, VPN/ExpressRoute gateways, DNS (private resolver, private zones), bastion, shared monitoring. Spokes hold workloads, peered to the hub, with UDRs forcing egress through the firewall. At scale: Azure Virtual WAN.

**29. How do you protect the origin behind Front Door?**
Allow only the `AzureFrontDoor.Backend` service tag in the NSG **and** validate the `X-Azure-FDID` header (other customers' Front Doors share the IPs). Best option: Front Door Premium **Private Link** to the origin, so it has no public exposure.

---

## E. Security, identity and governance

**30. Azure Policy vs RBAC?**
RBAC controls **who** can do an action. Policy controls **what** the resulting resource may look like, regardless of who creates it. You need both.

**31. How would you roll out Azure Policy at a client?**
Assign at management-group scope as **initiatives**, start in **Audit**, measure non-compliance, communicate with teams, then switch to **Deny** or use **DeployIfNotExists/Modify** for auto-remediation; use exemptions with expiry for justified cases; manage everything as code.

**32. What is an Azure landing zone?**
The Cloud Adoption Framework's target environment: management group hierarchy, identity, connectivity (hub/vWAN), policy-driven governance, management/monitoring, and subscription vending for application teams. Usually deployed with the Azure Verified Modules / ALZ Terraform modules.

**33. Defender for Cloud — what does it add?**
Security posture management (secure score, recommendations, attack paths) and workload protection plans (containers, SQL, Key Vault, servers…) with threat detection and vulnerability assessment. Policy prevents misconfiguration; Defender detects threats and risk.

**34. Least privilege for a deployment pipeline?**
A dedicated identity per environment, scoped to the subscription or resource groups it manages, with the minimum roles (Contributor + RBAC Administrator with conditions, instead of Owner), approvals for production, and separate identities for plan (read) and apply (write) when the client requires it.

---

## F. Observability and reliability

**35. Metrics, logs and traces — what do you use for what?**
Metrics for alerting and trends (cheap, aggregated), logs for detail and forensics, traces for request flow across services. Alert on symptoms (error rate, latency) rather than causes (CPU).

**36. What are SLI, SLO and error budget?**
SLI is the measurement (share of successful requests). SLO is the target (99.5% over 7 days). The error budget is the allowed failure (0.5%); when it is burning fast, you slow down releases and prioritize reliability.

**37. Azure Monitor vs Datadog — how do you advise?**
Azure-native (Container Insights, Managed Prometheus, Grafana) is integrated, cheaper and fine for platform metrics. Datadog gives stronger APM, cross-cloud correlation and a single pane for many teams, at higher cost. Decision factors: multi-cloud, existing tooling, budget, team skills.

**38. How do you avoid alert fatigue?**
Alert on user-impacting symptoms tied to SLOs, route by severity, every alert must have an owner and a runbook, review noisy alerts regularly, use multi-window burn-rate alerts instead of single thresholds.

---

## G. The open design question

**39. "Design a CI/CD platform for 20 teams deploying to AKS."**
Clarify first (number of clusters, compliance, existing tools). Then: landing zone with a platform subscription and app subscriptions; shared AKS per environment with namespaces per team, or dedicated clusters for regulated teams; Terraform modules owned by the platform team, consumed by app teams; pipelines from **extends templates** enforcing scans and approvals; OIDC identities per team/environment; GitOps (Argo CD ApplicationSets) for deployment; policy guardrails; central observability with per-team dashboards and SLOs; cost visibility through tags. Close with the main trade-off you would discuss with the client.

**40. "How would you migrate a client's classic release pipelines to YAML?"**
Inventory and group pipelines by pattern; build a small set of YAML templates; migrate one pilot team; run old and new in parallel for a release; replace release gates with environment checks; train teams; decommission classic pipelines. Measure lead time and failure rate before and after.
