<#
.SYNOPSIS
  Creates the API managed identity as a contained user in the 'portal' database.

.DESCRIPTION
  Azure SQL is private (public network disabled). To run this one-off DDL from
  your machine the script:
    1. re-applies 30-data with sql_temporary_public_access=true (firewall = your IP only)
    2. runs CREATE USER ... FROM EXTERNAL PROVIDER with your Entra login
       (you are a member of grp-mfs-sql-admins, created by 05-identity)
    3. re-applies 30-data with public access disabled again
  While step 1 is active, the policy "SQL must disable public network" reports
  NON-COMPLIANT — that is expected and a good thing to observe.

  Requires go-sqlcmd: winget install sqlcmd
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$azp = Join-Path $PSScriptRoot 'azp.ps1'

& $azp init 40-aks | Out-Null
$o = (& terraform "-chdir=$(Join-Path $Root 'infra/terraform/40-aks')" output -json) | ConvertFrom-Json
$server = $o.sql_server_fqdn.value
$identity = $o.portal_api_identity_name.value

$sqlText = @"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$identity')
  CREATE USER [$identity] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [$identity];
ALTER ROLE db_datawriter ADD MEMBER [$identity];
ALTER ROLE db_ddladmin  ADD MEMBER [$identity];
"@

try {
  & $azp apply 30-data -Var 'sql_temporary_public_access=true' -AutoApprove
  Write-Host "==> granting [$identity] on $server/portal"
  sqlcmd -S $server -d portal --authentication-method ActiveDirectoryDefault -Q $sqlText
  if ($LASTEXITCODE -ne 0) { throw 'sqlcmd failed (are you a member of grp-mfs-sql-admins? run az login again after joining).' }
}
finally {
  Write-Host '==> closing public access again'
  & $azp apply 30-data -AutoApprove
}
