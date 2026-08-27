[CmdletBinding()]
param(
  [string]$InstallRoot = 'E:\Computador\.leon\freellmapi',
  [string]$DataRoot = 'E:\Computador\.leon\freellmapi-data',
  [ValidateRange(1024, 65535)]
  [int]$Port = 31415
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Set-PrivateAcl {
  param(
    [Parameter(Mandatory)]
    [string]$LiteralPath,
    [Parameter(Mandatory)]
    [bool]$IsDirectory
  )

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
    $null
  ).Value
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid,
    $null
  ).Value

  $inheritance = if ($IsDirectory) { '(OI)(CI)' } else { '' }
  $grants = @(
    "*$currentSid`:$inheritance" + 'F'
    "*$systemSid`:$inheritance" + 'F'
    "*$administratorsSid`:$inheritance" + 'F'
  )
  $arguments = @($LiteralPath, '/inheritance:r', '/grant:r') + $grants + @('/q')
  & (Get-Command icacls.exe -ErrorAction Stop).Source @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel proteger as permissoes de $LiteralPath."
  }
}

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory)]
    [string]$LiteralPath,
    [Parameter(Mandatory)]
    [string]$Name
  )

  $escapedName = [regex]::Escape($Name)
  foreach ($line in Get-Content -LiteralPath $LiteralPath) {
    if ($line -match "^$escapedName=(.*)$") {
      return $Matches[1]
    }
  }
  return $null
}

$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$resolvedDataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$packagePath = Join-Path $resolvedInstallRoot 'package.json'
$entryPath = Join-Path $resolvedInstallRoot 'server\dist\index.js'
$envPath = Join-Path $resolvedInstallRoot '.env'

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  throw "FreeLLMAPI nao foi encontrado em $resolvedInstallRoot."
}
if (-not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
  throw 'A compilacao de producao nao foi encontrada. Execute npm run build antes do bootstrap.'
}

$backupRoot = Join-Path $resolvedDataRoot 'backups'
$logRoot = Join-Path $resolvedDataRoot 'logs'
foreach ($directory in @($resolvedDataRoot, $backupRoot, $logRoot)) {
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $directory)
  }
}
Set-PrivateAcl -LiteralPath $resolvedDataRoot -IsDirectory $true

$dbPath = (Join-Path $resolvedDataRoot 'freeapi.db').Replace('\', '/')
$backupPath = (Join-Path $backupRoot 'freeapi.db.backup').Replace('\', '/')
$expected = [ordered]@{
  NODE_ENV = 'production'
  HOST = '127.0.0.1'
  PORT = [string]$Port
  FREEAPI_DB_PATH = $dbPath
  FREEAPI_DB_DIR_HARDENING = '1'
  FREEAPI_DB_BACKUP_PATH = $backupPath
  FREEAPI_DB_BACKUP_INTERVAL_MS = '300000'
  REQUEST_ANALYTICS_LOG_CLIENT = 'false'
  REQUEST_ANALYTICS_RETENTION_DAYS = '30'
  REQUEST_ANALYTICS_MAX_ROWS = '50000'
}

$created = $false
if (Test-Path -LiteralPath $envPath -PathType Leaf) {
  $storedKey = Get-DotEnvValue -LiteralPath $envPath -Name 'ENCRYPTION_KEY'
  if ($storedKey -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'O arquivo .env existente nao contem uma ENCRYPTION_KEY valida de 64 caracteres hexadecimais.'
  }
  foreach ($name in $expected.Keys) {
    if ((Get-DotEnvValue -LiteralPath $envPath -Name $name) -cne $expected[$name]) {
      throw "O arquivo .env existente diverge da configuracao protegida em $name. Nenhum dado foi sobrescrito."
    }
  }
}
else {
  $keyBytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($keyBytes)
  $encryptionKey = [Convert]::ToHexString($keyBytes).ToLowerInvariant()

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("ENCRYPTION_KEY=$encryptionKey")
  foreach ($entry in $expected.GetEnumerator()) {
    $lines.Add("$($entry.Key)=$($entry.Value)")
  }
  [System.IO.File]::WriteAllLines(
    $envPath,
    $lines,
    [System.Text.UTF8Encoding]::new($false)
  )
  $created = $true
}

Set-PrivateAcl -LiteralPath $envPath -IsDirectory $false

[pscustomobject]@{
  Status = if ($created) { 'created' } else { 'validated' }
  InstallRoot = $resolvedInstallRoot
  DataRoot = $resolvedDataRoot
  Endpoint = "http://127.0.0.1:$Port"
  SecretPrinted = $false
}
