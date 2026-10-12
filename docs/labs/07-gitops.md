# Phase 07 — GitOps with Argo CD and the first delivery (6 h)

## 🎯 Goal

Get the portal running **without `kubectl apply` for the app**: Git declares the desired state and Argo CD converges the cluster to it.

## 🧠 Concepts

```text
gitops/
├── bootstrap/root-app.yaml      ← the ONLY manifest applied by hand (app-of-apps)
├── apps/                        ← Argo CD watches this folder: one Application per file
│   ├── platform-ingress.yaml    →  gitops/platform/ingress   (NGINX bound to the static IP)
│   ├── portal-dev.yaml          →  chart + envs/dev/*.yaml   (namespace portal-dev)
│   └── portal-prod.yaml         →  chart + envs/prod/*.yaml  (namespace portal-prod)
├── charts/customer-portal/      ← one Helm chart for every environment
├── envs/<env>/platform.values.yaml  ← GENERATED from Terraform (ACR, client id, KV, SQL)
├── envs/<env>/values.yaml           ← app config (tags, replicas, chaos) — changed by PR
└── addons/datadog/              ← off until phase 12
```

**The Terraform → GitOps bridge** is `platform.values.yaml`. Terraform creates resources with random suffixes; `render-gitops-values.ps1` reads the **outputs** and writes the values Helm needs. The file goes to Git through a PR, so Git remains the source of truth.

## 🛠️ Steps

### 1. Render the platform values and open a PR

```powershell
./scripts/render-gitops-values.ps1
git switch -c chore/platform-values
git add gitops/envs; git commit -m "chore(gitops): platform values from terraform outputs"
git push -u origin chore/platform-values
gh pr create --fill; gh pr merge --squash --delete-branch
```

### 2. Build the images (first time, no pipeline yet)

```powershell
./scripts/build-images.ps1 -Tag v1.0.0
```

`az acr build` builds **inside Azure** (ACR Tasks) — no local Docker needed. Then edit `gitops/envs/dev/values.yaml` and `gitops/envs/prod/values.yaml`, replace both `bootstrap` tags with `v1.0.0`, and commit/PR/merge as in step 1.

### 3. Grant the API access to the database

```powershell
./scripts/sql-grant-app-identity.ps1
```

Read it first: it opens SQL **temporarily** to your IP (through Terraform), creates the contained user for the managed identity, and **closes it again** in `finally`. In between, the phase 04 policy flags SQL as non-compliant — watch it in the portal.

### 4. Install Argo CD and hand control to Git

```powershell
./scripts/bootstrap-gitops.ps1
kubectl -n argocd port-forward svc/argocd-server 8080:80
```

Open <http://localhost:8080> (user `admin`; the script prints how to get the password). You will see `root` → `platform-ingress`, `portal-dev` and `portal-prod`.

### 5. Test without Front Door (for now)

The NSG allows your IP on 80/443 (rule 110). Use the `Host` header to simulate the domain:

```powershell
$ip = terraform -chdir=infra/terraform/40-aks output -raw ingress_public_ip_address
curl.exe -s -H "Host: portal-dev.edymonte.com.br" "http://$ip/api/info"
curl.exe -s -H "Host: portal-dev.edymonte.com.br" "http://$ip/api/products"
```

`/api/info` should show `"database": "azure-sql"` and the `banner` read from Key Vault.

## ✅ Checkpoint

- [ ] Every Application is `Synced` and `Healthy` in Argo CD.
- [ ] `/api/products` returns the 3 products from Azure SQL.
- [ ] Change the `portal-banner` secret in Key Vault: within 2 minutes `/api/info` shows the new text **without a restart** (CSI rotation).

## 💥 Break it — drift in the cluster

```powershell
kubectl -n portal-prod scale deploy customer-portal-web --replicas=0
kubectl -n portal-prod get deploy customer-portal-web -w
```

**Observation:** the Deployment goes back to 2 replicas by itself. **Why?** `selfHeal: true` in `apps/portal-prod.yaml`. **Question:** what if someone really needs to scale during an emergency? *(Open a PR changing `web.replicas`, or suspend auto-sync for that Application in an audited way.)*

## 🏋️ Challenge — full QA environment

Continuing the phase 06 challenge: deliver `portal-qa` at `portal-qa.edymonte.com.br` (via the Host header for now).

<details><summary>Answer</summary>

1. Terraform (phase 06): add `portal-qa` to `local.portal_namespaces`, `apply 40-aks`.
2. `gitops/apps/portal-qa.yaml`: copy `portal-dev.yaml`, replacing `dev` → `qa` in the name, `valueFiles` and namespace.
3. `gitops/envs/qa/values.yaml` with `environment: qa` and `ingress.host: portal-qa.edymonte.com.br`; `gitops/envs/qa/platform.values.yaml` (add `qa` to the `foreach` in `render-gitops-values.ps1`).
4. PR + merge → Argo CD creates everything. In phase 10, add `qa = "portal-qa"` to `local.hosts` in `50-edge` for a domain and certificate.

</details>

## 🎤 Interview

1. What is GitOps? How is it different from "a pipeline that runs `kubectl apply`"?
2. Pull vs push deployment: which has the smaller credential surface?
3. How do you roll back? *(`git revert` of the PR → Argo CD syncs.)*
4. Why is `platform.values.yaml` generated and committed, instead of Argo CD reading Terraform state?
5. Argo CD vs Flux: what drove the choice? (ADR-0002)
