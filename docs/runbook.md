# Runbook

## Daily cycle

```powershell
az login
./scripts/azp.ps1 status
./scripts/azp.ps1 up -Through 40-aks
./scripts/build-images.ps1 -Tag <tag-in-values.yaml>   # ACR is recreated empty
./scripts/sql-grant-app-identity.ps1                   # database is recreated empty
az keyvault secret set --vault-name <kv> --name portal-banner --value "..."   # vault is recreated empty
./scripts/bootstrap-gitops.ps1
# ...
./scripts/azp.ps1 down
```

> Names stay **stable** across the daily cycle: the suffix comes from `00-bootstrap` (`name_suffix`), so ACR, Key Vault, SQL and the ingress DNS label are recreated with the same names and `gitops/envs/*/platform.values.yaml` does not change. What is lost is **data**: images, secrets and the SQL contained user. Wrapping these steps in a `day-start.ps1` script is a good extra exercise. A production answer would be: keep stateful/shared resources (ACR, Key Vault) in a long-lived layer and only recycle compute.

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `Error acquiring the state lock` | A previous run crashed or is still running | Confirm nobody is running, then `terraform -chdir=<layer> force-unlock <LOCK_ID>` |
| `RequestDisallowedByPolicy` | `guardrail_effect=Deny` and the resource violates a guardrail | Read the message; fix the resource or go back to Audit |
| `QuotaExceeded` / `OperationNotAllowed ... cores` | Trial vCPU quota | Smaller VM size, fewer nodes, or upgrade + quota request |
| `MissingSubscriptionRegistration` | Resource provider not registered | `az provider register -n <namespace>` (phase 00) |
| `ForbiddenByFirewall` (Key Vault) | Your IP changed | Update `operatorIpRanges`, `bootstrap`, apply 10/30/40 |
| `kubectl` timeout | Your IP is not in AKS authorized ranges | Same as above |
| `kubectl` asks for device login / `Unauthorized` | kubeconfig not converted | `kubelogin convert-kubeconfig -l azurecli` |
| Front Door custom domain stuck in `Pending` | TXT validation not visible yet | `Resolve-DnsName _dnsauth.portal.edymonte.com.br -Type TXT -Server 8.8.8.8`; wait for propagation |
| Argo CD app `OutOfSync` with `SkipDryRunOnMissingResource` | CRD not installed yet (Datadog) | Sync the operator app first (sync waves already order it) |
| Pods `ImagePullBackOff` | Tag not in ACR or AcrPull missing | `az acr repository show-tags`; check kubelet identity role |
| API `/readyz` 503 | SQL user not granted, or private DNS problem | `sql-grant-app-identity.ps1`; `nslookup` from a pod |

## End of the lab (full cleanup)

```powershell
./scripts/azp.ps1 down
./scripts/azp.ps1 destroy 05-identity
terraform -chdir=infra/terraform/00-bootstrap destroy -var-file=../../../.runtime/bootstrap.tfvars.json
```

Then restore the original DNS servers at Registro.br if you want to use the domain elsewhere.
