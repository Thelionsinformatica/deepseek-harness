[CmdletBinding()]
param(
  [string]$InstallRoot = 'E:\Computador\.leon\freellmapi',
  [string]$DataRoot = 'E:\Computador\.leon\freellmapi-data',
  [ValidateRange(1024, 65535)]
  [int]$Port = 31415
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = 'https://github.com/tashfeenahmed/freellmapi.git'
$releaseTag = 'v0.9.0'
$releaseCommit = '3b6f40e9a3e1691dd7e561d9fa842c28d6218746'
$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$parentRoot = Split-Path -Parent $resolvedInstallRoot

$nodeVersionText = (& node --version).TrimStart('v')
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion.Major -lt 20 -or $nodeVersion.Major -ge 25) {
  throw "Node.js $nodeVersionText nao e suportado pelo FreeLLMAPI $releaseTag. Use Node.js 20 a 24."
}
[void](Get-Command npm -ErrorAction Stop)
[void](Get-Command git -ErrorAction Stop)

if (-not (Test-Path -LiteralPath $parentRoot -PathType Container)) {
  [void](New-Item -ItemType Directory -Path $parentRoot)
}

if (-not (Test-Path -LiteralPath $resolvedInstallRoot)) {
  & git clone --depth 1 --branch $releaseTag --single-branch $repository $resolvedInstallRoot
  if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel baixar a versao fixada do FreeLLMAPI.'
  }
}

$gitDirectory = Join-Path $resolvedInstallRoot '.git'
if (-not (Test-Path -LiteralPath $gitDirectory -PathType Container)) {
  throw "$resolvedInstallRoot ja existe, mas nao e a instalacao Git esperada. Nada foi sobrescrito."
}

$actualCommit = (& git -C $resolvedInstallRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -cne $releaseCommit) {
  throw "A instalacao existente nao esta no commit homologado $releaseCommit. Nenhuma atualizacao automatica foi feita."
}
$trackedChanges = @(& git -C $resolvedInstallRoot status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0 -or $trackedChanges.Count -gt 0) {
  throw 'A instalacao possui alteracoes rastreadas. A reinstalacao foi cancelada para preservar os arquivos.'
}

& npm ci --ignore-scripts --no-audit --no-fund --prefix $resolvedInstallRoot
if ($LASTEXITCODE -ne 0) {
  throw 'A instalacao deterministica das dependencias falhou.'
}

& npm rebuild better-sqlite3 --no-audit --no-fund --prefix $resolvedInstallRoot
if ($LASTEXITCODE -ne 0) {
  throw 'A compilacao isolada do better-sqlite3 falhou.'
}

Push-Location $resolvedInstallRoot
try {
  & node -e "require('better-sqlite3');"
  if ($LASTEXITCODE -ne 0) {
    throw 'O binding nativo do better-sqlite3 nao passou na validacao.'
  }
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'A compilacao de producao do FreeLLMAPI falhou.'
  }
}
finally {
  Pop-Location
}

$bootstrapScript = Join-Path $PSScriptRoot 'freellmapi-bootstrap.ps1'
if (-not (Test-Path -LiteralPath $bootstrapScript -PathType Leaf)) {
  throw "Script de bootstrap ausente: $bootstrapScript"
}
& $bootstrapScript -InstallRoot $resolvedInstallRoot -DataRoot $DataRoot -Port $Port

[pscustomobject]@{
  Status = 'installed'
  Version = $releaseTag
  Commit = $releaseCommit
  InstallRoot = $resolvedInstallRoot
  Endpoint = "http://127.0.0.1:$Port"
  Started = $false
}
