[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('windows', 'inspect', 'tree', 'invoke', 'set-value', 'select', 'screenshot', 'audit')]
  [string]$Command,

  [string]$WindowId,
  [string]$AllowProcess,
  [string]$AllowWindowId,
  [string]$AutomationId,
  [string]$ControlName,
  [string]$ControlType,
  [string]$Value,
  [string]$OutputPath,

  [ValidateRange(1, 12)]
  [int]$Depth = 5,

  [ValidateRange(1, 1000)]
  [int]$MaxNodes = 300,

  [ValidateRange(1, 200)]
  [int]$MaxWindows = 100,

  [ValidateRange(1, 200)]
  [int]$Limit = 50
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:MutatingCommands = @('invoke', 'set-value', 'select', 'screenshot')
$script:AuditTarget = [ordered]@{}

function Throw-UiaError {
  param([string]$Code, [string]$Message)

  $exception = [System.InvalidOperationException]::new($Message)
  $exception.Data['LeonCode'] = $Code
  throw $exception
}

function Get-UiaHome {
  $configured = $env:DSH_HOME
  if ([string]::IsNullOrWhiteSpace($configured)) {
    $profilePath = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    $configured = Join-Path $profilePath '.dsh'
  }
  return [IO.Path]::GetFullPath($configured)
}

function Get-AuditPath {
  return Join-Path (Join-Path (Get-UiaHome) 'windows-uia') 'audit.jsonl'
}

function Write-AuditEvent {
  param(
    [string]$Status,
    [string]$ErrorCode = '',
    [hashtable]$Result = @{}
  )

  $path = Get-AuditPath
  $directory = Split-Path -Parent $path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $event = [ordered]@{
    schemaVersion = 1
    occurredAt = [DateTimeOffset]::UtcNow.ToString('o')
    command = $Command
    status = $Status
    target = $script:AuditTarget
    result = $Result
  }
  if (-not [string]::IsNullOrWhiteSpace($ErrorCode)) {
    $event.errorCode = $ErrorCode
  }
  Add-Content -LiteralPath $path -Value ($event | ConvertTo-Json -Depth 8 -Compress) -Encoding utf8
}

function Read-AuditEvents {
  $path = Get-AuditPath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    return @()
  }
  $lines = @(Get-Content -LiteralPath $path -Tail $Limit)
  $events = foreach ($line in $lines) {
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      try { $line | ConvertFrom-Json } catch { }
    }
  }
  return @($events)
}

function Initialize-Uia {
  $isWindowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  if (-not $isWindowsHost) {
    Throw-UiaError 'PLATFORM_UNSUPPORTED' 'A automação de interface do Leon está disponível somente no Windows.'
  }

  Add-Type -AssemblyName UIAutomationClient | Out-Null
  Add-Type -AssemblyName UIAutomationTypes | Out-Null
  if (-not ('LeonUiaNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class LeonUiaNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
}
'@ | Out-Null
  }
}

function Get-ProcessNameSafe {
  param([int]$ProcessId)

  try {
    return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName
  }
  catch {
    return ''
  }
}

function Get-ControlTypeName {
  param([System.Windows.Automation.AutomationElement]$Element)

  $programmaticName = $Element.Current.ControlType.ProgrammaticName
  return $programmaticName -replace '^ControlType\.', ''
}

function Get-WindowMetadata {
  param([System.Windows.Automation.AutomationElement]$Element)

  $current = $Element.Current
  $processId = [int]$current.ProcessId
  $nativeHandle = [int64]$current.NativeWindowHandle
  return [ordered]@{
    windowId = "${processId}:$nativeHandle"
    name = [string]$current.Name
    processId = $processId
    processName = Get-ProcessNameSafe -ProcessId $processId
    nativeHandle = $nativeHandle
    automationId = [string]$current.AutomationId
    className = [string]$current.ClassName
    controlType = Get-ControlTypeName -Element $Element
    enabled = [bool]$current.IsEnabled
    offscreen = [bool]$current.IsOffscreen
  }
}

function Get-TopLevelWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $collection = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $windows = [System.Collections.Generic.List[object]]::new()
  for ($index = 0; $index -lt $collection.Count -and $windows.Count -lt $MaxWindows; $index += 1) {
    try {
      $metadata = Get-WindowMetadata -Element $collection.Item($index)
      if ($metadata.nativeHandle -ne 0 -and $metadata.processId -gt 0) {
        $windows.Add($metadata)
      }
    }
    catch { }
  }
  return @($windows)
}

function Get-WindowById {
  param([string]$RequestedWindowId)

  if ($RequestedWindowId -notmatch '^(?<processId>[1-9][0-9]*):(?<handle>-?[0-9]+)$') {
    Throw-UiaError 'INVALID_WINDOW_ID' 'Use um windowId retornado pela inspeção do Leon.'
  }
  $expectedProcessId = [int]$Matches.processId
  $expectedHandle = [int64]$Matches.handle
  if ($expectedHandle -eq 0) {
    Throw-UiaError 'INVALID_WINDOW_ID' 'O identificador da janela não pode conter um handle nulo.'
  }

  try {
    $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($expectedHandle))
  }
  catch {
    Throw-UiaError 'WINDOW_UNAVAILABLE' 'A janela indicada não está mais disponível.'
  }
  if ($null -eq $element -or $element.Current.ProcessId -ne $expectedProcessId) {
    Throw-UiaError 'WINDOW_STALE' 'O identificador da janela ficou desatualizado; inspecione novamente.'
  }
  return $element
}

function Get-FocusedWindow {
  $handle = [LeonUiaNative]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) {
    return $null
  }
  try {
    return [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  }
  catch {
    return $null
  }
}

function Resolve-Window {
  if ([string]::IsNullOrWhiteSpace($WindowId)) {
    return Get-FocusedWindow
  }
  return Get-WindowById -RequestedWindowId $WindowId
}

function Get-ControlSnapshot {
  param([System.Windows.Automation.AutomationElement]$Window)

  $nodes = [System.Collections.Generic.List[object]]::new()
  $queue = [System.Collections.Generic.Queue[object]]::new()
  $rootChildren = $Window.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  for ($index = 0; $index -lt $rootChildren.Count; $index += 1) {
    $queue.Enqueue([pscustomobject]@{ Element = $rootChildren.Item($index); ParentRef = $null; NodeDepth = 1 })
  }

  while ($queue.Count -gt 0 -and $nodes.Count -lt $MaxNodes) {
    $item = $queue.Dequeue()
    try {
      $element = [System.Windows.Automation.AutomationElement]$item.Element
      $current = $element.Current
      $reference = "uia-$($nodes.Count + 1)"
      $nodes.Add([ordered]@{
        ref = $reference
        parentRef = $item.ParentRef
        depth = $item.NodeDepth
        name = [string]$current.Name
        automationId = [string]$current.AutomationId
        controlType = Get-ControlTypeName -Element $element
        className = [string]$current.ClassName
        enabled = [bool]$current.IsEnabled
        offscreen = [bool]$current.IsOffscreen
        password = [bool]$current.IsPassword
      })

      if ($item.NodeDepth -lt $Depth) {
        $children = $element.FindAll(
          [System.Windows.Automation.TreeScope]::Children,
          [System.Windows.Automation.Condition]::TrueCondition
        )
        for ($childIndex = 0; $childIndex -lt $children.Count; $childIndex += 1) {
          $queue.Enqueue([pscustomobject]@{
            Element = $children.Item($childIndex)
            ParentRef = $reference
            NodeDepth = $item.NodeDepth + 1
          })
        }
      }
    }
    catch { }
  }

  return [ordered]@{
    controls = @($nodes)
    truncated = $queue.Count -gt 0
    depthLimit = $Depth
    nodeLimit = $MaxNodes
  }
}

function Assert-AllowedWindow {
  param([System.Windows.Automation.AutomationElement]$Window)

  if ($AllowWindowId -cne $WindowId) {
    Throw-UiaError 'ALLOWLIST_MISMATCH' 'A janela permitida não corresponde ao alvo solicitado.'
  }
  if ($AllowProcess -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') {
    Throw-UiaError 'INVALID_PROCESS_ALLOWLIST' 'O nome do processo permitido é inválido.'
  }

  $metadata = Get-WindowMetadata -Element $Window
  if (-not $metadata.processName.Equals($AllowProcess, [StringComparison]::OrdinalIgnoreCase)) {
    Throw-UiaError 'PROCESS_NOT_ALLOWED' 'O processo da janela não corresponde ao processo permitido.'
  }
  if ($metadata.windowId -cne $AllowWindowId) {
    Throw-UiaError 'WINDOW_NOT_ALLOWED' 'A janela atual não corresponde ao identificador permitido.'
  }
  $script:AuditTarget = [ordered]@{
    windowId = $metadata.windowId
    windowName = $metadata.name
    processName = $metadata.processName
  }
  return $metadata
}

function Assert-ActionAllowlistParameters {
  if ([string]::IsNullOrWhiteSpace($WindowId) -or
      [string]::IsNullOrWhiteSpace($AllowWindowId) -or
      [string]::IsNullOrWhiteSpace($AllowProcess)) {
    Throw-UiaError 'ALLOWLIST_REQUIRED' 'A ação exige windowId, allowWindowId e allowProcess explícitos.'
  }
  if ($AllowWindowId -cne $WindowId) {
    Throw-UiaError 'ALLOWLIST_MISMATCH' 'A janela permitida não corresponde ao alvo solicitado.'
  }
}

function Find-TargetControl {
  param([System.Windows.Automation.AutomationElement]$Window)

  if ([string]::IsNullOrWhiteSpace($AutomationId) -and [string]::IsNullOrWhiteSpace($ControlName)) {
    Throw-UiaError 'CONTROL_SELECTOR_REQUIRED' 'Informe automationId ou o nome exato do controle.'
  }

  $conditions = [System.Collections.Generic.List[System.Windows.Automation.Condition]]::new()
  if (-not [string]::IsNullOrWhiteSpace($AutomationId)) {
    $conditions.Add([System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      $AutomationId
    ))
  }
  if (-not [string]::IsNullOrWhiteSpace($ControlName)) {
    $conditions.Add([System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $ControlName
    ))
  }
  $condition = if ($conditions.Count -eq 1) {
    $conditions[0]
  }
  else {
    [System.Windows.Automation.AndCondition]::new($conditions.ToArray())
  }
  $matches = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $filtered = [System.Collections.Generic.List[System.Windows.Automation.AutomationElement]]::new()
  for ($index = 0; $index -lt $matches.Count; $index += 1) {
    $candidate = $matches.Item($index)
    if ([string]::IsNullOrWhiteSpace($ControlType) -or
        (Get-ControlTypeName -Element $candidate).Equals($ControlType, [StringComparison]::OrdinalIgnoreCase)) {
      $filtered.Add($candidate)
    }
  }
  if ($filtered.Count -eq 0) {
    Throw-UiaError 'CONTROL_NOT_FOUND' 'Nenhum controle corresponde ao seletor informado.'
  }
  if ($filtered.Count -gt 1) {
    Throw-UiaError 'CONTROL_AMBIGUOUS' 'Mais de um controle corresponde ao seletor; informe automationId ou controlType adicional.'
  }

  $target = $filtered[0]
  if (-not $target.Current.IsEnabled) {
    Throw-UiaError 'CONTROL_DISABLED' 'O controle está desabilitado.'
  }
  if ($target.Current.IsOffscreen) {
    Throw-UiaError 'CONTROL_OFFSCREEN' 'O controle está fora da área visível; inspecione a janela novamente.'
  }
  $script:AuditTarget.control = [ordered]@{
    automationId = [string]$target.Current.AutomationId
    name = [string]$target.Current.Name
    controlType = Get-ControlTypeName -Element $target
  }
  return $target
}

function Invoke-TargetControl {
  param([System.Windows.Automation.AutomationElement]$Target)

  $pattern = $null
  if ($Target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    return 'InvokePattern'
  }
  if ($Target.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
    ([System.Windows.Automation.TogglePattern]$pattern).Toggle()
    return 'TogglePattern'
  }
  if ($Target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
    return 'SelectionItemPattern'
  }
  Throw-UiaError 'ACTION_UNSUPPORTED' 'O controle não oferece um padrão seguro de acionamento.'
}

function Set-TargetValue {
  param([System.Windows.Automation.AutomationElement]$Target)

  if (-not $PSBoundParameters.ContainsKey('Target')) {
    Throw-UiaError 'CONTROL_SELECTOR_REQUIRED' 'O controle de destino é obrigatório.'
  }
  if (-not $script:InvocationParameters.ContainsKey('Value')) {
    Throw-UiaError 'VALUE_REQUIRED' 'Informe o valor a preencher.'
  }
  if ($Target.Current.IsPassword) {
    Throw-UiaError 'PASSWORD_CONTROL_REFUSED' 'O Leon não preenche campos de senha por UI Automation.'
  }
  $pattern = $null
  if (-not $Target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    Throw-UiaError 'ACTION_UNSUPPORTED' 'O controle não oferece preenchimento pelo padrão Value.'
  }
  if (([System.Windows.Automation.ValuePattern]$pattern).Current.IsReadOnly) {
    Throw-UiaError 'CONTROL_READ_ONLY' 'O controle é somente leitura.'
  }
  $valuePattern = [System.Windows.Automation.ValuePattern]$pattern
  $valuePattern.SetValue($Value)
  $verified = $false
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if ($valuePattern.Current.Value -ceq $Value) {
      $verified = $true
      break
    }
    Start-Sleep -Milliseconds 50
  }
  if (-not $verified) {
    Throw-UiaError 'VALUE_VERIFICATION_FAILED' 'O controle não confirmou o valor solicitado; a ação não será declarada como concluída.'
  }
  return 'ValuePattern'
}

function Select-TargetControl {
  param([System.Windows.Automation.AutomationElement]$Target)

  $pattern = $null
  if (-not $Target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    Throw-UiaError 'ACTION_UNSUPPORTED' 'O controle não oferece seleção pelo padrão SelectionItem.'
  }
  ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
  return 'SelectionItemPattern'
}

function Save-WindowScreenshot {
  param([System.Windows.Automation.AutomationElement]$Window)

  if ([string]::IsNullOrWhiteSpace($OutputPath) -or -not [IO.Path]::IsPathFullyQualified($OutputPath)) {
    Throw-UiaError 'ABSOLUTE_OUTPUT_REQUIRED' 'Informe um caminho absoluto para um novo arquivo PNG.'
  }
  $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
  if ([IO.Path]::GetExtension($resolvedOutput) -cne '.png') {
    Throw-UiaError 'PNG_OUTPUT_REQUIRED' 'A captura deve usar a extensão .png.'
  }
  if (Test-Path -LiteralPath $resolvedOutput) {
    Throw-UiaError 'OUTPUT_ALREADY_EXISTS' 'A captura não sobrescreve arquivos existentes.'
  }
  $parent = Split-Path -Parent $resolvedOutput
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    Throw-UiaError 'OUTPUT_DIRECTORY_MISSING' 'A pasta de destino da captura não existe.'
  }

  $metadata = Get-WindowMetadata -Element $Window
  $rectangle = [LeonUiaNative+Rect]::new()
  if (-not [LeonUiaNative]::GetWindowRect([IntPtr]::new($metadata.nativeHandle), [ref]$rectangle)) {
    Throw-UiaError 'WINDOW_BOUNDS_UNAVAILABLE' 'Não foi possível obter os limites da janela.'
  }
  $width = $rectangle.Right - $rectangle.Left
  $height = $rectangle.Bottom - $rectangle.Top
  if ($width -le 0 -or $height -le 0 -or $width -gt 10000 -or $height -gt 10000 -or
      ([int64]$width * [int64]$height) -gt 50000000) {
    Throw-UiaError 'WINDOW_BOUNDS_UNSAFE' 'Os limites da janela são inválidos ou grandes demais para captura.'
  }

  Add-Type -AssemblyName System.Drawing.Common | Out-Null
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen(
      $rectangle.Left,
      $rectangle.Top,
      0,
      0,
      [System.Drawing.Size]::new($width, $height),
      [System.Drawing.CopyPixelOperation]::SourceCopy
    )
    $stream = [IO.File]::Open($resolvedOutput, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $stream.Dispose()
    }
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  return $resolvedOutput
}

$script:InvocationParameters = $PSBoundParameters
$auditRecorded = $false

try {
  if ($Command -eq 'audit') {
    $response = [ordered]@{
      ok = $true
      command = $Command
      auditPath = Get-AuditPath
      events = @(Read-AuditEvents)
    }
  }
  else {
    Initialize-Uia
    switch ($Command) {
      'windows' {
        $response = [ordered]@{
          ok = $true
          command = $Command
          observedAt = [DateTimeOffset]::UtcNow.ToString('o')
          windows = @(Get-TopLevelWindows)
        }
      }
      { $_ -in @('inspect', 'tree') } {
        $window = Resolve-Window
        if ($null -eq $window) {
          $response = [ordered]@{
            ok = $true
            command = $Command
            available = $false
            reason = 'FOCUSED_WINDOW_UNAVAILABLE'
          }
        }
        else {
          $snapshot = Get-ControlSnapshot -Window $window
          $response = [ordered]@{
            ok = $true
            command = $Command
            available = $true
            observedAt = [DateTimeOffset]::UtcNow.ToString('o')
            window = Get-WindowMetadata -Element $window
            controls = $snapshot.controls
            truncated = $snapshot.truncated
            depthLimit = $snapshot.depthLimit
            nodeLimit = $snapshot.nodeLimit
          }
        }
      }
      'invoke' {
        Assert-ActionAllowlistParameters
        $window = Get-WindowById -RequestedWindowId $WindowId
        $metadata = Assert-AllowedWindow -Window $window
        $target = Find-TargetControl -Window $window
        $pattern = Invoke-TargetControl -Target $target
        $result = @{ pattern = $pattern }
        Write-AuditEvent -Status 'succeeded' -Result $result
        $auditRecorded = $true
        $response = [ordered]@{ ok = $true; command = $Command; window = $metadata; result = $result; auditRecorded = $true }
      }
      'set-value' {
        Assert-ActionAllowlistParameters
        $window = Get-WindowById -RequestedWindowId $WindowId
        $metadata = Assert-AllowedWindow -Window $window
        $target = Find-TargetControl -Window $window
        $pattern = Set-TargetValue -Target $target
        $result = @{ pattern = $pattern; valueLength = $Value.Length }
        Write-AuditEvent -Status 'succeeded' -Result $result
        $auditRecorded = $true
        $response = [ordered]@{ ok = $true; command = $Command; window = $metadata; result = $result; auditRecorded = $true }
      }
      'select' {
        Assert-ActionAllowlistParameters
        $window = Get-WindowById -RequestedWindowId $WindowId
        $metadata = Assert-AllowedWindow -Window $window
        $target = Find-TargetControl -Window $window
        $pattern = Select-TargetControl -Target $target
        $result = @{ pattern = $pattern }
        Write-AuditEvent -Status 'succeeded' -Result $result
        $auditRecorded = $true
        $response = [ordered]@{ ok = $true; command = $Command; window = $metadata; result = $result; auditRecorded = $true }
      }
      'screenshot' {
        Assert-ActionAllowlistParameters
        $window = Get-WindowById -RequestedWindowId $WindowId
        $metadata = Assert-AllowedWindow -Window $window
        $savedPath = Save-WindowScreenshot -Window $window
        $result = @{ outputPath = $savedPath }
        Write-AuditEvent -Status 'succeeded' -Result $result
        $auditRecorded = $true
        $response = [ordered]@{ ok = $true; command = $Command; window = $metadata; result = $result; auditRecorded = $true }
      }
    }
  }

  $response | ConvertTo-Json -Depth 20
  exit 0
}
catch {
  $code = 'WINDOWS_UIA_ERROR'
  if ($_.Exception.Data.Contains('LeonCode')) {
    $code = [string]$_.Exception.Data['LeonCode']
  }
  if ($Command -in $script:MutatingCommands -and -not $auditRecorded) {
    try {
      Write-AuditEvent -Status 'failed' -ErrorCode $code
      $auditRecorded = $true
    }
    catch { }
  }
  [ordered]@{
    ok = $false
    command = $Command
    error = [ordered]@{
      code = $code
      message = $_.Exception.Message
    }
    auditRecorded = $auditRecorded
  } | ConvertTo-Json -Depth 12
  exit 1
}
