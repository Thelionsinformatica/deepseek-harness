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
# The fixture shares the user's desktop, so it must remain UIA-visible without accepting ambient keyboard input.
if (-not ('LeonUiaTestForm' -as [type])) {
  $formReferences = @(
    [System.Windows.Forms.Form].Assembly.Location
    [System.ComponentModel.Component].Assembly.Location
  )
  Add-Type -TypeDefinition @'
using System.Windows.Forms;

public sealed class LeonUiaTestForm : Form
{
    private const int WsExNoActivate = 0x08000000;

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= WsExNoActivate;
            return parameters;
        }
    }
}
'@ -ReferencedAssemblies $formReferences
}

$form = [LeonUiaTestForm]::new()
$form.Text = $Title
$form.Name = 'LeonTestWindow'
$form.Width = 360
$form.Height = 180
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Left = 40
$form.Top = 40
$form.ShowInTaskbar = $false
$form.Opacity = 0.05

$editor = [System.Windows.Forms.TextBox]::new()
$editor.Name = 'LeonEditor'
$editor.Left = 20
$editor.Top = 20
$editor.Width = 300
$editor.Height = 30
$editor.ShortcutsEnabled = $false
$editor.ImeMode = [System.Windows.Forms.ImeMode]::Disable
$editor.Add_KeyPress({ $_.Handled = $true })

$button = [System.Windows.Forms.Button]::new()
$button.Name = 'LeonActionButton'
$button.Text = 'Aplicar'
$button.Left = 20
$button.Top = 65
$button.Width = 100
$button.Height = 32
$button.Add_Click({ [IO.File]::WriteAllText($MarkerPath, $editor.Text) })

$status = [System.Windows.Forms.Label]::new()
$status.Name = 'LeonStatus'
$status.Text = 'Aguardando'
$status.Left = 140
$status.Top = 72
$status.Width = 180
$status.Height = 24

$form.Controls.AddRange(@($editor, $button, $status))
$form.Add_Shown({ [IO.File]::WriteAllText($ReadyPath, [string]$PID) })
[System.Windows.Forms.Application]::Run($form)

