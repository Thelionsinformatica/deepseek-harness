param(
  [Parameter(Mandatory = $true)]
  [string]$MarkerPath,

  [Parameter(Mandatory = $true)]
  [string]$ReadyPath,

  [Parameter(Mandatory = $true)]
  [string]$Title
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

# The fixture shares the user's desktop, so it must remain UIA-visible without accepting ambient keyboard input.
$window = [System.Windows.Window]::new()
$window.Title = $Title
$window.Name = 'LeonTestWindow'
$window.Width = 360
$window.Height = 180
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$window.Left = 40
$window.Top = 40
$window.ShowInTaskbar = $false
$window.Opacity = 0.05
$window.ShowActivated = $false

$canvas = [System.Windows.Controls.Canvas]::new()

$editor = [System.Windows.Controls.TextBox]::new()
$editor.Name = 'LeonEditor'
$editor.Width = 300
$editor.Height = 30
$editor.Focusable = $false
[System.Windows.Controls.Canvas]::SetLeft($editor, 20)
[System.Windows.Controls.Canvas]::SetTop($editor, 20)

$button = [System.Windows.Controls.Button]::new()
$button.Name = 'LeonActionButton'
$button.Content = 'Aplicar'
$button.Width = 100
$button.Height = 32
$button.Add_Click({ [IO.File]::WriteAllText($MarkerPath, $editor.Text) })
[System.Windows.Controls.Canvas]::SetLeft($button, 20)
[System.Windows.Controls.Canvas]::SetTop($button, 65)

$status = [System.Windows.Controls.Label]::new()
$status.Name = 'LeonStatus'
$status.Content = 'Aguardando'
$status.Width = 180
$status.Height = 24
[System.Windows.Controls.Canvas]::SetLeft($status, 140)
[System.Windows.Controls.Canvas]::SetTop($status, 72)

$canvas.Children.Add($editor) | Out-Null
$canvas.Children.Add($button) | Out-Null
$canvas.Children.Add($status) | Out-Null
$window.Content = $canvas
$window.Add_ContentRendered({ [IO.File]::WriteAllText($ReadyPath, [string]$PID) })
$window.Show() | Out-Null
[System.Windows.Threading.Dispatcher]::Run()
