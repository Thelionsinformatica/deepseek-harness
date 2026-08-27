[CmdletBinding()]
param(
  [string]$InstallRoot = 'E:\Computador\.leon\freellmapi',
  [string]$DataRoot = 'E:\Computador\.leon\freellmapi-data',
  [ValidateRange(1024, 65535)]
  [int]$Port = 31415,
  [ValidateRange(5, 120)]
  [int]$StartupTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PortListeners {
  param([int]$LocalPort)
  return @(Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue)
}

function Test-Livez {
  param([int]$LocalPort)
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/livez" -TimeoutSec 3
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

function Test-ExpectedProcess {
  param(
    [int]$ProcessId,
    [string]$ExpectedEntry
  )
  $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $process -or $process.Name -notmatch '^node(?:\.exe)?$') {
    return $false
  }
  return $process.CommandLine.IndexOf($ExpectedEntry, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

$resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$resolvedDataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$entryPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot 'server\dist\index.js'))
$envPath = Join-Path $resolvedInstallRoot '.env'
$logRoot = Join-Path $resolvedDataRoot 'logs'

foreach ($requiredFile in @($entryPath, $envPath)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Arquivo obrigatorio ausente: $requiredFile"
  }
}
if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) {
  [void](New-Item -ItemType Directory -Path $logRoot)
}

$listeners = @(Get-PortListeners -LocalPort $Port)
if ($listeners.Count -gt 0) {
  $invalidAddress = @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
  $unexpectedProcess = @($listeners | Where-Object { -not (Test-ExpectedProcess -ProcessId $_.OwningProcess -ExpectedEntry $entryPath) })
  if ($invalidAddress.Count -eq 0 -and $unexpectedProcess.Count -eq 0 -and (Test-Livez -LocalPort $Port)) {
    [pscustomobject]@{
      Status = 'already-running'
      ProcessId = $listeners[0].OwningProcess
      Endpoint = "http://127.0.0.1:$Port"
      BoundToLoopback = $true
    }
    exit 0
  }
  throw "A porta $Port ja esta ocupada por um servico diferente ou exposto fora do loopback."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $logRoot "freellmapi-$timestamp.stdout.log"
$stderrPath = Join-Path $logRoot "freellmapi-$timestamp.stderr.log"
$startParameters = @{
  FilePath = $nodePath
  ArgumentList = @($entryPath)
  WorkingDirectory = $resolvedInstallRoot
  WindowStyle = 'Hidden'
  RedirectStandardOutput = $stdoutPath
  RedirectStandardError = $stderrPath
  PassThru = $true
}
$process = Start-Process @startParameters

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if ($process.HasExited) {
    throw "FreeLLMAPI encerrou durante a inicializacao. Consulte $stderrPath."
  }
  if (Test-Livez -LocalPort $Port) {
    break
  }
  Start-Sleep -Milliseconds 400
}

if (-not (Test-Livez -LocalPort $Port)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw "FreeLLMAPI nao ficou saudavel em $StartupTimeoutSeconds segundos. Consulte $stderrPath."
}

$listeners = @(Get-PortListeners -LocalPort $Port)
$invalidListeners = @($listeners | Where-Object {
  $_.OwningProcess -ne $process.Id -or $_.LocalAddress -notin @('127.0.0.1', '::1')
})
if ($listeners.Count -eq 0 -or $invalidListeners.Count -gt 0) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw 'FreeLLMAPI respondeu, mas o vinculo de rede nao corresponde ao processo local protegido.'
}

[pscustomobject]@{
  Status = 'started'
  ProcessId = $process.Id
  Endpoint = "http://127.0.0.1:$Port"
  BoundToLoopback = $true
  StandardOutput = $stdoutPath
  StandardError = $stderrPath
}
