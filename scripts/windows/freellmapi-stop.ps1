[CmdletBinding()]
param(
  [string]$InstallRoot = 'E:\Computador\.leon\freellmapi',
  [ValidateRange(1024, 65535)]
  [int]$Port = 31415
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$entryPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot 'server\dist\index.js'))
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)

if ($listeners.Count -eq 0) {
  [pscustomobject]@{
    Status = 'already-stopped'
    Port = $Port
  }
  exit 0
}

$processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
if ($processIds.Count -ne 1) {
  throw "A porta $Port tem mais de um processo associado; a parada segura foi cancelada."
}

$processId = [int]$processIds[0]
$process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
if ($null -eq $process -or $process.Name -notmatch '^node(?:\.exe)?$') {
  throw "A porta $Port nao pertence a um processo Node.js reconhecido; nada foi encerrado."
}
if ($process.CommandLine.IndexOf($entryPath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
  throw "A porta $Port nao pertence a esta instalacao do FreeLLMAPI; nada foi encerrado."
}

Stop-Process -Id $processId
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  if (@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -eq 0) {
    [pscustomobject]@{
      Status = 'stopped'
      ProcessId = $processId
      Port = $Port
    }
    exit 0
  }
  Start-Sleep -Milliseconds 250
}

throw "O processo recebeu a solicitacao de parada, mas a porta $Port continuou aberta."
