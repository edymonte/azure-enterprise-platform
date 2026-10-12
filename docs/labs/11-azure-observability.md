# Phase 11 — Azure observability: Prometheus, Grafana and alerts (4 h)

## 🎯 Goal

See the portal's **golden signals** (traffic, errors, latency, saturation) in Azure Managed Grafana, query logs with KQL, and get an SLO alert by e-mail when you inject failures.

## 🧠 Concepts

```text
API /metrics ──PodMonitor──► ama-metrics (in AKS) ──DCR──► Azure Monitor workspace (Prometheus)
                                                                  │
                     PromQL alert rule group (40-aks) ◄───────────┤
                                 │                                └──► Managed Grafana (60)
                                 ▼
                         Action Group → e-mail

Container stdout ──ama-logs──DCR──► Log Analytics (ContainerLogV2, KQL)
```

- The app exports **RED** metrics: `http_requests_total{status}` (Rate, Errors) and `http_request_duration_seconds` (Duration, histogram).
- **Alert on symptoms, not causes**: error ratio and p95 latency, not CPU.

## 🛠️ Steps

### 1. Apply Grafana and import the dashboard

```powershell
./scripts/azp.ps1 apply 60-observability
./scripts/grafana-import.ps1
```

Open the Grafana endpoint printed by the script, dashboard **Customer Portal — Golden Signals**, pick the Prometheus data source.

### 2. Generate traffic

```powershell
1..600 | ForEach-Object { curl.exe -s -o NUL https://portal.edymonte.com.br/api/products; Start-Sleep -Milliseconds 200 }
```

(Without phase 10 active, use the ingress IP + Host header from phase 07.)

### 3. Query logs with KQL (*Log Analytics → Logs*)

```kusto
ContainerLogV2
| where PodNamespace == "portal-prod" and ContainerName == "api"
| extend log = parse_json(LogMessage)
| where log.level == "error"
| project TimeGenerated, PodName, msg = tostring(log.msg)
| order by TimeGenerated desc
```

The API logs JSON on purpose: structured logs make this query possible.

### 4. Trigger an SLO alert through GitOps

In `gitops/envs/prod/values.yaml`, set `chaos.errorRate: "0.2"` → PR → merge. Keep the traffic loop running. Within ~5–10 minutes `PortalHighErrorRatio` fires and you get an e-mail. Revert the PR to recover.

> Notice the operational pattern: even a failure injection goes through Git. It is audited and reversible.

## ✅ Checkpoint

- [ ] Dashboard shows traffic, error ratio, p50/p95/p99 and CPU per pod.
- [ ] KQL query returns the injected errors.
- [ ] Alert e-mail received and auto-resolved after the revert.

## 🏋️ Challenge — dashboard as code

Add a panel "Requests by route (top 5)" to `observability/dashboards/grafana-customer-portal.json` and re-import.

<details><summary>Answer</summary>

```json
{
  "id": 6, "title": "Requests by route (top 5)", "type": "bargauge",
  "gridPos": { "x": 0, "y": 23, "w": 24, "h": 6 },
  "datasource": { "type": "prometheus", "uid": "${datasource}" },
  "targets": [{ "refId": "A",
    "expr": "topk(5, sum by (route) (rate(http_requests_total{namespace=\"$namespace\"}[5m])))",
    "legendFormat": "{{route}}" }]
}
```

</details>

## 🎤 Interview

1. Golden signals vs RED vs USE — which for what?
2. Why histograms instead of averages for latency?
3. Container Insights vs Managed Prometheus: what does each collect?
4. How do you avoid alert fatigue?
5. What is an error budget and how does it influence releases?
