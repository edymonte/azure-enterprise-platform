<#
.SYNOPSIS
  Imports the versioned Grafana dashboards into Azure Managed Grafana.
  Requires: az extension add --name amg
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

& (Join-Path $PSScriptRoot 'azp.ps1') init 60-observability | Out-Null
$o = (& terraform "-chdir=$(Join-Path $Root 'infra/terraform/60-observability')" output -json) | ConvertFrom-Json

Get-ChildItem (Join-Path $Root 'observability/dashboards') -Filter 'grafana-*.json' | ForEach-Object {
  Write-Host "==> importing $($_.Name)"
  az grafana dashboard import --name $o.grafana_name.value --resource-group $o.grafana_resource_group_name.value `
    --definition $_.FullName --overwrite true
}
Write-Host "Grafana: $($o.grafana_endpoint.value)"
