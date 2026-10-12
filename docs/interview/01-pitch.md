# The pitch

## 30 seconds — "Tell me about a project you are proud of"

> "Recently I built an enterprise-style Azure platform as a reference for a fictional financial company. Everything is Terraform, split into layers with separate state — identity, network, governance, data, AKS and edge. The application runs on AKS behind Front Door with WAF, talks to Azure SQL and Key Vault only through private endpoints, and uses Workload Identity, so there are **no secrets anywhere** — not even in the pipelines, which use OIDC federation for both GitHub Actions and Azure DevOps. Deployments are GitOps with Argo CD, and I monitor it with both Managed Prometheus/Grafana and Datadog, with SLO-based alerts."

## 2 minutes — "Walk me through the architecture"

Draw while you talk (boxes left to right: **user → DNS → Front Door → AKS → SQL/Key Vault**, hub below).

1. **Context (15 s)** — "The requirement was a customer portal with production constraints: custom domain and WAF, nothing exposed publicly, no manual deployments, auditable compliance, and two delivery tools because the client had teams on both GitHub and Azure DevOps."

2. **Entry (20 s)** — "Traffic enters through Azure Front Door Premium — TLS terminates there with a managed certificate and the WAF runs the Microsoft default rule set. I rolled it out in Detection mode first and switched to Prevention after checking the logs. The origin is a static public IP on the AKS ingress, but the NSG only allows the `AzureFrontDoor.Backend` service tag, so you cannot bypass Front Door."

3. **Compute and identity (25 s)** — "AKS uses Azure CNI Overlay with Cilium, Entra ID authentication with local accounts disabled, and Workload Identity. The API's service account is federated with a user-assigned managed identity, which is a contained user in Azure SQL and has Secrets User on Key Vault. So no connection strings with passwords."

4. **Network (15 s)** — "Hub and spoke: private DNS zones live in the hub and are linked to the spoke; SQL and Key Vault have private endpoints and public access disabled."

5. **Delivery (20 s)** — "CI builds, scans with Trivy and pushes to ACR, then opens a pull request that bumps the image tag in the GitOps folder. Argo CD syncs the cluster. The pipeline never has cluster credentials, promotion to production is a PR, and rollback is a git revert."

6. **Governance and ops (15 s)** — "Azure Policy initiative at subscription scope — allowed locations, mandatory tags, SQL without public access — plus the AKS pod security baseline. Defender for Cloud for containers, SQL and Key Vault. Observability with Managed Prometheus and Grafana for the platform and Datadog APM for the app, with alerts on error rate and p95 latency."

7. **Close with a trade-off (10 s)** — "If this were real production, I would add a private AKS cluster with self-hosted agents, Premium ACR with a private endpoint, and Front Door Private Link to the origin instead of a public IP. I documented those decisions as ADRs."

## Likely follow-ups (have one sentence ready)

| Follow-up | One-liner |
|---|---|
| "Why layers instead of one Terraform root?" | "Blast radius, plan speed, ownership by team, and I can destroy the expensive layer without touching the database." |
| "Why Argo CD and not Flux?" | "Both are CNCF GitOps tools; I picked Argo CD for the UI and its market adoption. Flux is the native AKS extension and a great choice when you want Microsoft to manage the controller." |
| "Why both Prometheus and Datadog?" | "Many clients have both: native for cheap platform metrics, Datadog for APM and cross-team correlation. I wanted to be able to compare them honestly." |
| "What was the hardest part?" | Pick one: private DNS resolution for private endpoints, or OIDC subject mismatches. Tell it as a troubleshooting story (Observation → Hypothesis → Evidence → Fix). |
| "What would you do differently?" | "Start with policies in Audit from day one and agree on naming and tagging with the client before writing any Terraform." |
