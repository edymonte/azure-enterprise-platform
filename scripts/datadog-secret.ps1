<#
.SYNOPSIS
  Creates the Kubernetes secret with the Datadog API key — read from Key Vault.

.DESCRIPTION
  The key is stored ONCE in Key Vault (never in Git, never in Terraform state):
    az keyvault secret set --vault-name <kv> --name datadog-api-key --value <key>
  This script copies it into the 'datadog' namespace as 'datadog-secret'.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

& (Join-Path $PSScriptRoot 'azp.ps1') init 40-aks | Out-Null
$kv = ((& terraform "-chdir=$(Join-Path $Root 'infra/terraform/40-aks')" output -json) | ConvertFrom-Json).key_vault_name.value

$apiKey = az keyvault secret show --vault-name $kv --name datadog-api-key --query value -o tsv
if (-not $apiKey) { throw "Secret 'datadog-api-key' not found in $kv." }

kubectl create namespace datadog --dry-run=client -o yaml | kubectl apply -f -
kubectl -n datadog create secret generic datadog-secret --from-literal=api-key=$apiKey --dry-run=client -o yaml | kubectl apply -f -
Write-Host 'datadog-secret created/updated in namespace datadog.'
