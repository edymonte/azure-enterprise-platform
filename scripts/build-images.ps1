<#
.SYNOPSIS
  Builds the API and web images INSIDE Azure (ACR Tasks) — no local Docker needed.

.DESCRIPTION
  Used for the very first deploy (before the CI pipelines exist) and for
  comparing "manual build" with the pipeline later.
#>
[CmdletBinding()]
param(
  [string]$Tag = "manual-$(Get-Date -Format 'yyyyMMddHHmm')"
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

& (Join-Path $PSScriptRoot 'azp.ps1') init 40-aks | Out-Null
$acr = ((& terraform "-chdir=$(Join-Path $Root 'infra/terraform/40-aks')" output -json) | ConvertFrom-Json).acr_name.value

az acr build --registry $acr --image "customer-portal-api:$Tag" (Join-Path $Root 'app/customer-portal/api')
az acr build --registry $acr --image "customer-portal-web:$Tag" (Join-Path $Root 'app/customer-portal/web')

Write-Host "`nSet image.api.tag and image.web.tag to '$Tag' in gitops/envs/dev/values.yaml and open a PR."
