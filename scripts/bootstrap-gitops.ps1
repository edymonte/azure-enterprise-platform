<#
.SYNOPSIS
  One-time cluster bootstrap: credentials, Argo CD install, app-of-apps.

.DESCRIPTION
  After this script, NOBODY runs kubectl apply / helm install for the platform
  or the app again: changes go through Git and Argo CD reconciles them.
  This is the only imperative step of the delivery model.
#>
[CmdletBinding()]
param(
  [string]$ArgoChartVersion = '8.1.3'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

& (Join-Path $PSScriptRoot 'azp.ps1') init 40-aks | Out-Null
$o = (& terraform "-chdir=$(Join-Path $Root 'infra/terraform/40-aks')" output -json) | ConvertFrom-Json
$rg = $o.resource_group_name.value
$cluster = $o.cluster_name.value

Write-Host "==> az aks get-credentials ($cluster) + kubelogin (Entra ID auth, local accounts are disabled)"
az aks get-credentials --resource-group $rg --name $cluster --overwrite-existing
kubelogin convert-kubeconfig -l azurecli
kubectl get nodes -o wide

Write-Host '==> helm install argo-cd'
helm repo add argo https://argoproj.github.io/argo-helm --force-update | Out-Null
helm upgrade --install argocd argo/argo-cd --version $ArgoChartVersion `
  --namespace argocd --create-namespace `
  -f (Join-Path $Root 'gitops/bootstrap/argocd-values.yaml') --wait --timeout 10m

Write-Host '==> kubectl apply root app (app-of-apps)'
kubectl apply -f (Join-Path $Root 'gitops/bootstrap/root-app.yaml')

Write-Host @'

Argo CD UI:
  kubectl -n argocd port-forward svc/argocd-server 8080:80
  user: admin
  password: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
'@
