# Phase 06 — Production-grade AKS (6 h)

## 🎯 Goal

Bring up the portal cluster with the choices a platform team would make in production: Entra ID-only access, Workload Identity, Overlay networking with Cilium, managed add-ons (ingress, Key Vault CSI, Policy, Defender), and metrics/logs collection. Then understand **every** choice.

## 🧠 Concepts — the decisions inside `azurerm_kubernetes_cluster`

| Setting | Choice | Why |
|---|---|---|
| `local_account_disabled = true` + `azure_rbac_enabled` | No "admin" kubeconfig | All cluster access goes through Entra ID and is auditable. Leavers lose access when removed from the group. |
| `api_server_access_profile.authorized_ip_ranges` | Your IP only | Public API server, but filtered. Production: private cluster + agents/runners in the VNet. |
| `network_plugin_mode = "overlay"` + `network_data_plane = "cilium"` | CNI Overlay + Cilium | Pods don't consume VNet IPs; Cilium (eBPF) enforces NetworkPolicy efficiently. |
| `oidc_issuer_enabled` + `workload_identity_enabled` | Workload Identity | Pods exchange their ServiceAccount token for an Entra token (HOW-IT-WORKS §7.2). |
| `web_app_routing {}` | Managed NGINX | Ingress maintained by Microsoft (upgrades, patches). |
| `key_vault_secrets_provider` | CSI driver | Key Vault secrets mounted as files, with rotation. |
| `azure_policy_enabled` | Gatekeeper | Enforces in-cluster the baseline assigned in phase 04. |
| `oms_agent` + `monitor_metrics` + DCRs | Container Insights + Managed Prometheus | Logs → Log Analytics, metrics → Azure Monitor workspace. |
| `automatic_upgrade_channel = "patch"` | Automatic patches | Security fixes for free; minor upgrades remain a human decision. |
| `lifecycle.ignore_changes = [kubernetes_version, node_count]` | | The autoscaler and auto-upgrade change these; without it, Terraform would "undo" their work on every `plan`. |

## 🛠️ Steps

### 1. Apply (≈ 10–15 min)

```powershell
./scripts/azp.ps1 apply 40-aks
```

While it runs, read `40-aks/monitoring.tf`: why are there **two** associations for Prometheus (endpoint and rule)? And why must the endpoint association be named exactly `configurationAccessEndpoint`?

### 2. Access the cluster like a human in a company would

```powershell
az aks get-credentials -g rg-mfs-portal-lab -n aks-mfs-portal-lab --overwrite-existing
kubelogin convert-kubeconfig -l azurecli      # uses your az login as the Entra credential
kubectl get nodes -o wide
```

### 3. Inspect the add-ons

```powershell
kubectl get pods -n app-routing-system            # managed NGINX
kubectl get pods -n kube-system | Select-String 'ama-|csi|azure-wi|cilium|microsoft-defender'
kubectl get pods -n gatekeeper-system             # Azure Policy
kubectl get constrainttemplates                   # pod baseline rules
```

### 4. Private DNS from inside the cluster

```powershell
$sql = terraform -chdir=infra/terraform/30-data output -raw sql_server_fqdn
kubectl run dnscheck --rm -it --restart=Never --image=busybox:1.36 -- nslookup $sql
```

Now the answer is `10.60.8.x`. Compare with phase 05.

## ✅ Checkpoint

- [ ] `kubectl get nodes` works with your Entra identity.
- [ ] `ama-metrics*`, `ama-logs*`, `secrets-store-csi*` and app-routing `nginx` pods are `Running`.
- [ ] SQL resolves to a private IP from inside the cluster.
- [ ] In *Azure Monitor workspace → Metrics*, the query `up` returns cluster series.

## 💥 Break it — "kubectl stopped working"

Simulate your home IP changing:

```powershell
./scripts/azp.ps1 apply 10-foundation -Var 'operator_ip_ranges=["198.51.100.1/32"]'
./scripts/azp.ps1 apply 40-aks
kubectl get nodes
```

- **Observation:** timeout (not 401/403).
- **Hypothesis:** the block happens before authentication, at the API server's network layer.
- **Evidence:** `az aks show -g rg-mfs-portal-lab -n aks-mfs-portal-lab --query apiServerAccessProfile.authorizedIpRanges`.
- **Lesson:** *timeout* points to network; *Unauthorized/Forbidden* points to identity or RBAC. Restore the IP and apply again.

## 🏋️ Challenge — a third environment

QA asked for a `portal-qa` namespace with Key Vault and SQL access, just like dev and prod. **Which Terraform lines** must change so the API running in `portal-qa` can authenticate?

<details><summary>Answer</summary>

Only one, in `40-aks/main.tf`:

```hcl
portal_namespaces = ["portal-dev", "portal-qa", "portal-prod"]
```

`for_each` creates `fic-portal-qa`. The plan shows **1 to add** and nothing else, because `for_each` addresses by key. (With `count`, inserting in the middle of the list would recreate prod's credential — that is why `for_each` is the right choice.) The GitOps side (Application + values) is the phase 07 challenge.

</details>

## 🎤 Interview

1. Explain Workload Identity and compare it with the old pod identity and with service principal secrets.
2. Why disable AKS local accounts?
3. Azure CNI Overlay vs classic Azure CNI vs kubenet — when to use each?
4. Why `ignore_changes` on `node_count`?
5. The cluster is public with authorized IPs. What would a private cluster look like, and how would you and the pipeline reach it?
