# Phase 12 — Datadog: APM, logs, monitors and SLO as code (5 h)

## 🎯 Goal

Add Datadog as the second observability stack: Agent installed **by GitOps**, APM traces from the API, and monitors, an SLO and a dashboard managed **by Terraform**. Then compare it with phase 11.

> Create the Datadog trial account (14 days) **at the start of this phase**.

## 🧠 Concepts

| Piece | Where | How |
|---|---|---|
| Datadog Operator + `DatadogAgent` | AKS, namespace `datadog` | Argo CD Applications in `gitops/addons/datadog` |
| API key | Key Vault → K8s Secret | `scripts/datadog-secret.ps1` |
| APM | API pods | `dd-trace` enabled by `datadog.enabled: true` in Helm values |
| Unified service tagging | Pod labels `tags.datadoghq.com/{env,service,version}` | Links traces, logs and metrics of the same release |
| Monitors, SLO, dashboard | Datadog | Terraform layer `70-datadog` (provider `DataDog/datadog`) |

**Why `DD_AGENT_HOST=datadog-agent.datadog.svc`?** The common `hostPort`/`hostIP` approach violates the AKS **pod security baseline** (phase 04). The Operator creates a node-local Service (`internalTrafficPolicy: Local`), which keeps traffic on the node *and* passes the policy. A good interview story about policy vs convenience.

## 🛠️ Steps

### 1. Account and keys

1. Sign up at <https://www.datadoghq.com> and **note your site** (US1 = `datadoghq.com`, US5 = `us5.datadoghq.com`, EU = `datadoghq.eu`, …).
2. *Organization settings*: create an **API key** and an **Application key**.
3. Store the API key in Key Vault (never in Git):

```powershell
$kv = terraform -chdir=infra/terraform/30-data output -raw key_vault_name
az keyvault secret set --vault-name $kv --name datadog-api-key --value '<api-key>'
./scripts/datadog-secret.ps1
```

### 2. Turn the Agent on through GitOps

1. Set `spec.global.site` in `gitops/platform/datadog/datadog-agent.yaml` to your site.
2. Move the add-on into the watched folder and enable APM in both environments:

```powershell
git switch -c feat/datadog
git mv gitops/addons/datadog/datadog-operator.yaml gitops/apps/
git mv gitops/addons/datadog/datadog-agent.yaml   gitops/apps/
# in gitops/envs/dev/values.yaml and gitops/envs/prod/values.yaml:  datadog.enabled: true
git commit -am "feat(observability): enable Datadog agent and APM"; git push -u origin feat/datadog
gh pr create --fill; gh pr merge --squash --delete-branch
```

3. Check: `kubectl -n datadog get datadogagent,pods`. In Datadog: *Infrastructure → Kubernetes* shows the cluster; *APM → Services* shows `customer-portal-api` after some traffic.

### 3. Monitoring as code

```powershell
$env:DD_API_KEY = '<api-key>'
$env:DD_APP_KEY = '<app-key>'
$env:DD_HOST    = 'https://api.datadoghq.com'      # use your site: https://api.us5.datadoghq.com, https://api.datadoghq.eu ...
./scripts/azp.ps1 apply 70-datadog -Var 'notify_handles=["@you@example.com"]'
```

Read `70-datadog/main.tf`: three monitors (error rate, p95 latency, restarts), an SLO (good requests / total over 7 days) and a dashboard rendered by `templatefile()` with the SLO id injected.

### 4. Same failure, two stacks

Repeat the phase 11 chaos PR (`chaos.errorRate: "0.2"` in prod). Compare:

| Question | Azure Monitor / Grafana | Datadog |
|---|---|---|
| Time to alert | | |
| Can you see *which* request failed and why? | | |
| Can you jump from the alert to the logs of that request? | | |
| Effort to set up | | |
| Cost model | | |

Fill the table — it is your answer to "Azure Monitor or Datadog?" in interviews.

## ✅ Checkpoint

- [ ] Datadog Agent running; cluster visible in Datadog.
- [ ] APM service `customer-portal-api` with traces tagged `env:prod` / `env:dev` and the image version.
- [ ] Monitors, SLO and dashboard created by Terraform; error-rate monitor fired during chaos.

## 💥 Break it

Delete the `datadog-secret` (`kubectl -n datadog delete secret datadog-secret`) and restart the agent pods. **Observation:** agents crash or stop reporting. **Question:** how would you make the secret itself GitOps-managed without putting the key in Git? *(External Secrets Operator or the Key Vault CSI driver syncing into a K8s Secret, using Workload Identity.)*

## 🎤 Interview

1. What is unified service tagging and why does it matter?
2. How did you deploy the Datadog Agent, and how is the API key protected?
3. Why monitors as code?
4. Azure Monitor vs Datadog: how would you advise a client?
