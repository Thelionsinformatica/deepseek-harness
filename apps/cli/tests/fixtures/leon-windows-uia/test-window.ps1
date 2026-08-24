param(
  [Parameter(Mandatory = $true)]
  [string]$MarkerPath,

  [Parameter(Mandatory = $true)]
  [string]$ReadyPath,

  [Parameter(Mandatory = $true)]
  [string]$Title
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing.Common

$form = [System.Windows.Forms.Form]::new()
$form.Text = $Title
$form.Name = 'LeonTestWindow'
$form.Size = [System.Drawing.Size]::new(360, 180)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = [System.Drawing.Point]::new(40, 40)
$form.ShowInTaskbar = $false
$form.Opacity = 0.05

$editor = [System.Windows.Forms.TextBox]::new()
$editor.Name = 'LeonEditor'
$editor.Location = [System.Drawing.Point]::new(20, 20)
$editor.Size = [System.Drawing.Size]::new(300, 30)

$button = [System.Windows.Forms.Button]::new()
$button.Name = 'LeonActionButton'
$button.Text = 'Aplicar'
$button.Location = [System.Drawing.Point]::new(20, 65)
$button.Size = [System.Drawing.Size]::new(100, 32)
$button.Add_Click({ [IO.File]::WriteAllText($MarkerPath, $editor.Text) })

$status = [System.Windows.Forms.Label]::new()
$status.Name = 'LeonStatus'
$status.Text = 'Aguardando'
$status.Location = [System.Drawing.Point]::new(140, 72)
$status.Size = [System.Drawing.Size]::new(180, 24)

$form.Controls.AddRange(@($editor, $button, $status))
$form.Add_Shown({ [IO.File]::WriteAllText($ReadyPath, [string]$PID) })
[System.Windows.Forms.Application]::Run($form)
