# Phase 00 — Prerequisites (2 h)

## 🎯 Goal

Get your machine, your trial subscription and your repository ready. At the end, `./scripts/azp.ps1 bootstrap` has everything it needs.

## 🛠️ Steps

### 1. Tools (Windows, PowerShell 7)

```powershell
winget install --id Hashicorp.Terraform        # >= 1.12.2
winget install --id Microsoft.AzureCLI
winget install --id Helm.Helm
winget install --id Git.Git
winget install --id GitHub.cli
winget install --id OpenJS.NodeJS.LTS           # Node 24
winget install --id Microsoft.Sqlcmd            # go-sqlcmd (phase 07)
az aks install-cli                              # kubectl + kubelogin
az extension add --name amg                     # Azure Managed Grafana (phase 11)
```

Check:

```powershell
terraform version; az version; kubectl version --client; kubelogin --version; helm version; node -v; sqlcmd --version
```

### 2. Trial subscription

1. Sign up at <https://azure.microsoft.com/free> with a **personal e-mail**. Do not use your employer's subscription: besides company policy, you must be *Owner* and *Global Administrator* of your own tenant to create Entra apps and subscription-wide policies.
2. Log in and check the subscription:

```powershell
az login
az account show --query "{name:name, id:id, tenant:tenantId, user:user.name}" -o table
```

3. Register the resource providers used by the lab (some are not registered on new subscriptions):

```powershell
$providers = 'Microsoft.ContainerService','Microsoft.ContainerRegistry','Microsoft.ContainerInstance',
  'Microsoft.Network','Microsoft.Cdn','Microsoft.KeyVault','Microsoft.Sql','Microsoft.Monitor',
  'Microsoft.Dashboard','Microsoft.Insights','Microsoft.OperationalInsights','Microsoft.AlertsManagement',
  'Microsoft.Security','Microsoft.PolicyInsights','Microsoft.Consumption'
$providers | ForEach-Object { az provider register --namespace $_ }
# check (may take a few minutes):
$providers | ForEach-Object { "{0,-35} {1}" -f $_, (az provider show -n $_ --query registrationState -o tsv) }
```

4. Check your vCPU quota (AKS needs 2–4):

```powershell
az vm list-usage --location eastus2 -o table | Select-String 'Total Regional vCPUs|DSv5'
```

### 3. Your public IP (for firewalls)

The AKS API server, Key Vault and SQL only accept your IP:

```powershell
"$(Invoke-RestMethod https://api.ipify.org)/32"
```

> Home IPs change. If `kubectl` or Key Vault suddenly answer *Forbidden* or time out, update `operatorIpRanges`, re-run `bootstrap` (it regenerates `.runtime/common.tfvars.json`) and apply layers 10, 30 and 40. That is also a game day.

### 4. GitHub repository

Argo CD reads **this** repository, so it must be on GitHub as `edymonte/azure-enterprise-platform`. Public is simplest: Argo CD needs no credential and the project doubles as a portfolio — there are no secrets in the repo.

```powershell
cd C:\Projects\azure-enterprise-platform
gh repo create edymonte/azure-enterprise-platform --public --source . --remote origin
git add -A; git commit -m "chore: initial platform scaffold"; git push -u origin main
```

If you pick another name, change `repoURL` in `gitops/bootstrap/root-app.yaml` and `gitops/apps/*.yaml`.

### 5. Lab settings

```powershell
Copy-Item config/lab.settings.example.json config/lab.settings.json
code config/lab.settings.json
```

| Field | Value |
|---|---|
| `subscriptionId` | output of `az account show --query id -o tsv` |
| `alertEmail` | your e-mail (budget and alerts) |
| `operatorIpRanges` | `["<your-ip>/32"]` |
| `publicDnsZoneName` | `edymonte.com.br` |
| `monthlyBudgetAmount` | e.g. `150` (subscription currency) |
| `budgetStartDate` | first day of the current month |

`config/lab.settings.json` is git-ignored.

## ✅ Checkpoint

- [ ] `az account show` shows the trial subscription.
- [ ] Every provider shows `Registered`.
- [ ] Code pushed to GitHub.
- [ ] `config/lab.settings.json` filled in.

## 🎤 Interview

1. Why must a *resource provider* be registered before use?
2. Why not use a corporate subscription for a lab that creates Entra apps and subscription-wide policies?
