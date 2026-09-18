# Agent Note: Windows PowerShell 5.1 下的 Windows UIA 连接器

Status: implemented

[English](2026-09-18-leon-windows-uia-legacy-powershell.md) | 中文

## 问题

当 `resolvePwshPath` 回退到 `powershell.exe`（Windows PowerShell 5.1，.NET Framework）时，两处仅存在于 .NET Core 的调用使 `screenshot` 失败：程序集名 `System.Drawing.Common` 不存在，`[IO.Path]::IsPathFullyQualified` 在 .NET Core 2.1 才加入。此外，测试 fixture 依赖 WinForms 控件把 `Name` 作为 UIA AutomationId 上报；在原生 .NET Framework 下 MSAA 桥只报告 `Pane` 元素和以 HWND 派生的 id，`-AutomationId LeonEditor` 永远无法解析。

## 决定

连接器按 `$PSVersionTable.PSEdition` 加载 `System.Drawing` 或 `System.Drawing.Common`，并用显式的盘符或 UNC 检查校验绝对输出路径，保持 `IsPathFullyQualified` 的契约。测试 fixture 改用 WPF 窗口实现：WPF 的 UIA 提供程序是原生的，在两个版本下都把 `Name` 报为 AutomationId。fixture 契约不变（MarkerPath/ReadyPath/Title 参数、不激活的低透明度窗口、ready 文件写入 PID、点击写入编辑器文本）。

## 验证

`apps/cli/tests/leon-windows-uia.spec.ts` 在 `powershell.exe` 5.1 下 6 项测试全部通过，包括 set-value、invoke、screenshot 和两个相同窗口的允许列表用例。PowerShell 7 下行为不变。

## 考虑过的替代方案

强制要求 PowerShell 7 会无产品理由地收窄可用机器范围。已验证 AppContext 辅助功能开关无法让旧版 WinForms 提供程序上报 AutomationId。放宽 AutomationId 契约会削弱连接器赖以成立的语义化目标定位。

## 后果

leon-windows 技能在两种 PowerShell 版本下均可用。连接器的默认只读、精确允许列表变更门控、审计轨迹和拒绝规则均不变。
