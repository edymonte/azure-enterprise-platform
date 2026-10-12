# Game days (phase 13, 6 h)

Each game day is a **ticket** you receive without knowing the cause. Ideally ask someone (or an AI assistant) to inject it for you. Follow the method every time and write a 5-line post-mortem.

```text
Observation → Known facts → Hypothesis → Test → Evidence → Conclusion → Change (via Git/Terraform) → Validation
```

Post-mortem template: **What happened · Impact · Root cause · How we detected it · What we changed so it does not happen again.**

---

## GD-01 — "Customers see errors on the product page" {#gd-01}

**Inject:** `chaos.errorRate: "0.3"` in `gitops/envs/prod/values.yaml` (PR + merge).
**Expected detection:** `PortalHighErrorRatio` (Azure) and the Datadog error-rate monitor.
<details><summary>Resolution path</summary>
Dashboards show 5xx only on `/api/products` → recent change? Argo CD history shows a values change → `git revert` → Argo CD syncs → error ratio back to 0. Post-mortem item: require a reviewer from the SRE group for chaos flags in prod.
</details>

## GD-02 — "The portal is slow" {#gd-02}

**Inject:** `chaos.latencyMs: "800"` in prod.
<details><summary>Resolution path</summary>
p95 alert fires; CPU is normal (so not saturation); HPA does not help (latency is not CPU-bound). Trace in Datadog shows time spent inside the handler before the DB call → config change → revert.
</details>

## GD-03 — "Deploy succeeded but the new version never went live"

**Inject:** in a PR, set `image.api.tag` in dev to a tag that does not exist (`v9.9.9`).
<details><summary>Resolution path</summary>
Argo CD shows `Progressing`/`Degraded`; pods in `ImagePullBackOff`; `kubectl describe pod` → `manifest unknown`. Rolling update keeps old pods serving (that is why the site stayed up). Fix: revert. Prevention: the app pipeline only writes tags it has just pushed.
</details>

## GD-04 — "API cannot reach the database after a network change"

**Inject:** delete the `link-portal` VNet link of `privatelink.database.windows.net` in the portal.
<details><summary>Resolution path</summary>
`/readyz` returns 503 → pods not ready → `nslookup` from a pod returns the **public** IP → private zone not linked to the spoke → `apply 10-foundation` recreates it (drift). Prevention: scheduled `plan` for drift detection; resource lock on private DNS zones.
</details>

## GD-05 — "Pipeline fails to authenticate to Azure"

**Inject:** change a federated credential subject in `05-identity` (or in the portal).
<details><summary>Resolution path</summary>
`AADSTS700213` = authentication/federation, not RBAC. Compare subject from the error with `az ad app federated-credential list`. Fix in Terraform. Prevention: plan on PR for the identity layer.
</details>

## GD-06 — "Security team says SQL is exposed"

**Inject:** `./scripts/azp.ps1 apply 30-data -Var 'sql_temporary_public_access=true'` and leave it.
<details><summary>Resolution path</summary>
Policy compliance shows `sqlNoPublicNetwork` non-compliant; Defender may raise a recommendation. Close access with `apply 30-data`. Then the real fix: switch `guardrail_effect` to `Deny` so it cannot happen again — and discuss the trade-off (the grant script would then need another path: a jump pod inside the VNet).
</details>

## GD-07 — "Someone scaled production by hand"

**Inject:** `kubectl -n portal-prod scale deploy customer-portal-web --replicas=0`.
<details><summary>Resolution path</summary>
Argo CD self-heal restores it in seconds; check *History and rollback* and the Kubernetes audit logs (Log Analytics `AKSAudit` if enabled) to find who did it. Discuss: should humans have write RBAC on prod namespaces at all?
</details>

## GD-08 — "Primary region is down" (needs the TM lab)

**Inject:** `az container stop -g rg-mfs-dr-lab -n aci-mfs-portal-primary`.
<details><summary>Resolution path</summary>
Traffic Manager endpoint goes `Degraded`; DNS answers move to the DR site after probes + TTL. Measure the real failover time. Discuss RTO/RPO and why Front Door origin groups fail over faster for HTTP.
</details>

## GD-09 — "WAF is blocking legitimate customers"

**Inject:** with `waf_mode=Prevention`, lower `waf_rate_limit_per_minute` to `10` and browse normally.
<details><summary>Resolution path</summary>
Customers get 429/403; WAF logs (phase 10 challenge) show `RateLimitPerClient`. Tune the threshold based on real traffic percentiles; consider per-path rules. This is why WAFs start in Detection.
</details>
