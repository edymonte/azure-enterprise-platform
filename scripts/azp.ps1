<#
.SYNOPSIS
  Lifecycle of the layered Terraform platform (Azure Enterprise Platform lab).

.DESCRIPTION
  Every Terraform command is PRINTED before it runs, so you can learn the exact
  commands and run them by hand later. Nothing here is magic: the script only
  adds the backend configuration and the shared variables for you.

.EXAMPLE
  ./scripts/azp.ps1 bootstrap                 # 00-bootstrap (local state) + .runtime files
  ./scripts/azp.ps1 plan 10-foundation        # init + plan one layer
  ./scripts/azp.ps1 apply 10-foundation       # plan, confirm, apply
  ./scripts/azp.ps1 up -Through 40-aks        # apply 05 -> 40 in order
  ./scripts/azp.ps1 down                      # destroy 70 -> 10 (keeps 00 and 05)
  ./scripts/azp.ps1 apply 50-edge -Var 'waf_mode=Prevention'
  ./scripts/azp.ps1 status
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, Position = 0)]
  [ValidateSet('bootstrap', 'init', 'plan', 'apply', 'destroy', 'output', 'up', 'down', 'status')]
  [string]$Command,

  [Parameter(Position = 1)]
  [string]$Layer,

  [string]$Through = '40-aks',

  [string[]]$Var = @(),

  [switch]$AutoApprove
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = Split-Path $PSScriptRoot -Parent
$TfRoot = Join-Path $Root 'infra/terraform'
$Runtime = Join-Path $Root '.runtime'
$SettingsFile = Join-Path $Root 'config/lab.settings.json'
$BackendFile = Join-Path $Runtime 'backend.hcl'
$CommonVars = Join-Path $Runtime 'common.tfvars.json'

# Order matters: each layer reads the outputs of the previous ones.
$Layers = @('05-identity', '10-foundation', '20-governance', '30-data', '40-aks', '50-edge', '60-observability', '70-datadog')
# 'down' keeps 00-bootstrap (state, DNS zone, budget) and 05-identity (free, slow to re-trust).
$DailyLayers = $Layers | Where-Object { $_ -ne '05-identity' }

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Invoke-Tf([string]$Dir, [string[]]$Arguments) {
  $rel = [IO.Path]::GetRelativePath($Root, $Dir)
  Write-Host "    terraform -chdir=$rel $($Arguments -join ' ')" -ForegroundColor DarkGray
  & terraform "-chdir=$Dir" @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "terraform $($Arguments[0]) failed in $rel (exit $LASTEXITCODE)" }
}

function Get-Settings {
  if (-not (Test-Path $SettingsFile)) {
    throw "Missing $SettingsFile. Copy config/lab.settings.example.json and fill it in (docs/labs/00-prerequisites.md)."
  }
  Get-Content $SettingsFile -Raw | ConvertFrom-Json
}

function Assert-Layer([string]$Name) {
  if (-not $Name) { throw "Layer is required. Valid: $($Layers -join ', ')" }
  if ($Layers -notcontains $Name) { throw "Unknown layer '$Name'. Valid: $($Layers -join ', ')" }
  if ($Name -eq '70-datadog' -and -not ($env:DD_API_KEY -and $env:DD_APP_KEY)) {
    throw '70-datadog needs DD_API_KEY, DD_APP_KEY (and DD_HOST if your site is not US1) in the environment.'
  }
}

function Get-VarArgs([string]$Dir) {
  $result = @("-var-file=$CommonVars")
  $local = Join-Path $Dir 'terraform.tfvars'
  if (Test-Path $local) { $result += "-var-file=$local" }
  foreach ($v in $Var) { $result += "-var=$v" }
  return $result
}

function Initialize-Layer([string]$Name) {
  if (-not (Test-Path $BackendFile)) { throw 'Run "./scripts/azp.ps1 bootstrap" first (.runtime/backend.hcl is missing).' }
  $dir = Join-Path $TfRoot $Name
  Write-Step "init $Name (state key: $Name.tfstate)"
  Invoke-Tf $dir @('init', '-input=false', '-reconfigure', "-backend-config=$BackendFile", "-backend-config=key=$Name.tfstate")
  return $dir
}

function Confirm-Apply([string]$What) {
  if ($AutoApprove) { return $true }
  $answer = Read-Host "Apply $What? [y/N]"
  return $answer -match '^[Yy]$'
}

function Invoke-Layer([string]$Name, [string]$Action) {
  Assert-Layer $Name
  $dir = Initialize-Layer $Name
  New-Item -ItemType Directory -Force (Join-Path $Runtime 'plans') | Out-Null
  $plan = Join-Path $Runtime "plans/$Name.tfplan"
  $varArgs = Get-VarArgs $dir

  switch ($Action) {
    'init' { return }
    'output' { Invoke-Tf $dir @('output'); return }
    'plan' {
      Write-Step "plan $Name"
      Invoke-Tf $dir (@('plan', '-input=false', "-out=$plan") + $varArgs)
    }
    'apply' {
      Write-Step "plan $Name"
      Invoke-Tf $dir (@('plan', '-input=false', "-out=$plan") + $varArgs)
      if (Confirm-Apply $Name) {
        Write-Step "apply $Name"
        Invoke-Tf $dir @('apply', '-input=false', $plan)
      } else { Write-Host "Skipped. Reviewed plan kept at $plan" }
    }
    'destroy' {
      Write-Step "plan -destroy $Name"
      Invoke-Tf $dir (@('plan', '-destroy', '-input=false', "-out=$plan") + $varArgs)
      if (Confirm-Apply "DESTROY of $Name") {
        Invoke-Tf $dir @('apply', '-input=false', $plan)
      } else { Write-Host 'Destroy cancelled.' }
    }
  }
}

function Invoke-Bootstrap {
  $s = Get-Settings
  $dir = Join-Path $TfRoot '00-bootstrap'
  New-Item -ItemType Directory -Force $Runtime | Out-Null

  $bootstrapVars = Join-Path $Runtime 'bootstrap.tfvars.json'
  @{
    subscription_id       = $s.subscriptionId
    location              = $s.location
    alert_email           = $s.alertEmail
    public_dns_zone_name  = $s.publicDnsZoneName
    monthly_budget_amount = $s.monthlyBudgetAmount
    budget_start_date     = $s.budgetStartDate
  } | ConvertTo-Json | Set-Content $bootstrapVars -Encoding utf8

  Write-Step '00-bootstrap uses LOCAL state (it creates the remote state storage)'
  Invoke-Tf $dir @('init', '-input=false')
  Invoke-Tf $dir @('plan', '-input=false', "-var-file=$bootstrapVars", '-out=bootstrap.tfplan')
  if (-not (Confirm-Apply '00-bootstrap')) { return }
  Invoke-Tf $dir @('apply', '-input=false', 'bootstrap.tfplan')
  Remove-Item (Join-Path $dir 'bootstrap.tfplan') -ErrorAction SilentlyContinue

  $o = (& terraform "-chdir=$dir" output -json) | ConvertFrom-Json

  Write-Step 'Writing .runtime/backend.hcl (shared remote-state settings)'
  @"
subscription_id      = "$($s.subscriptionId)"
resource_group_name  = "$($o.state_resource_group_name.value)"
storage_account_name = "$($o.state_storage_account_name.value)"
container_name       = "$($o.state_container_name.value)"
use_azuread_auth     = true
"@ | Set-Content $BackendFile -Encoding utf8

  Write-Step 'Writing .runtime/common.tfvars.json (variables shared by every layer)'
  @{
    subscription_id              = $s.subscriptionId
    location                     = $s.location
    alert_email                  = $s.alertEmail
    operator_ip_ranges           = @($s.operatorIpRanges)
    github_repository            = $s.githubRepository
    state_resource_group_name    = $o.state_resource_group_name.value
    state_storage_account_name   = $o.state_storage_account_name.value
    dns_zone_name                = $o.dns_zone_name.value
    dns_zone_resource_group_name = $o.dns_zone_resource_group_name.value
    name_suffix                  = $o.name_suffix.value
  } | ConvertTo-Json | Set-Content $CommonVars -Encoding utf8

  Write-Step 'Delegate the domain at Registro.br to these Azure DNS name servers:'
  $o.dns_zone_name_servers.value | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
}

function Show-Status {
  foreach ($name in $Layers) {
    $dir = Join-Path $TfRoot $name
    try {
      & terraform "-chdir=$dir" init -input=false -reconfigure "-backend-config=$BackendFile" "-backend-config=key=$name.tfstate" *> $null
      $count = @(& terraform "-chdir=$dir" state list 2>$null).Count
    } catch { $count = 0 }
    $label = if ($count -gt 0) { "DEPLOYED ($count resources)" } else { 'empty' }
    Write-Host ('{0,-18} {1}' -f $name, $label)
  }
}

switch ($Command) {
  'bootstrap' { Invoke-Bootstrap }
  'status' { Show-Status }
  'up' {
    $stop = [array]::IndexOf($Layers, $Through)
    if ($stop -lt 0) { throw "Unknown layer '$Through'" }
    foreach ($name in $Layers[0..$stop]) { Invoke-Layer $name 'apply' }
  }
  'down' {
    $reverse = [array]$DailyLayers
    [array]::Reverse($reverse)
    foreach ($name in $reverse) {
      if ($name -eq '70-datadog' -and -not $env:DD_API_KEY) { Write-Host 'Skipping 70-datadog (no DD_API_KEY).'; continue }
      Invoke-Layer $name 'destroy'
    }
  }
  default { Invoke-Layer $Layer $Command }
}
