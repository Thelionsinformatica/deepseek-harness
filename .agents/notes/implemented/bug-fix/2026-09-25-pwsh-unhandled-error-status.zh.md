# Agent Note: 在后续成功掩盖故障前停止未处理的 PowerShell 错误

Status: implemented

[English](2026-09-25-pwsh-unhandled-error-status.md) | 中文

## 问题

PowerShell 的默认继续策略允许方法调用或 cmdlet 输出错误后继续执行成功语句。一个哈希检查命令将十六进制字符串传给要求字节数组的 `BitConverter.ToString`；字符串插值输出空哈希，后续输出成功，进程以 0 退出。工具正确返回进程结果，但没有非零退出标记提醒消费方执行曾中途失败。

## 决策

`pwsh-local` 的 argv 前导代码在调用方文本之前设置 `$ErrorActionPreference = 'Stop'`。未处理的 PowerShell 错误会终止前台和后台命令；`pwsh-sandbox` 继承相同调用。错误诊断与进程状态仍由 PowerShell 和子进程收集器负责。不进行 stderr 分类或历史扫描。

显式 `try/catch`、`-ErrorAction` 与脚本偏好覆盖保留 PowerShell 语义。原生程序的 stderr 不作为错误信号，原生退出码仍通过 `exit $LASTEXITCODE` 显式传递。脚本可以有意继续或抑制错误；执行器不会覆盖该决定，也不推断命令的业务结果是否正确。

工具结果约定保持不变：`isError` 描述工具或传输故障，而已完成命令返回带类型的退出、超时、取消和信号信息。非零命令退出沿用 `[exit code: N]` 标记。这保留了 [PowerShell 工具决策](../feature/2026-08-01-pwsh-tool-and-executor.zh.md) 的结果与展示约定。

## 考虑过的替代方案

**匹配看起来像错误的 stderr 文本。** 拒绝，因为程序可能合法输出诊断、引用错误消息或将消息本地化。文本匹配会误判有效命令，并抑制合法流内容。

**将任何 `$Error` 条目视为失败。** 拒绝，因为 PowerShell 会保留调用方已捕获或显式抑制的错误。这会把已处理故障标为不成功。

**用自定义 catch 包裹每个命令并合成工具错误。** 拒绝，因为它改变错误格式，并混淆命令失败与执行器失败。PowerShell 的停止策略已经提供终止与退出状态。

## 后果

未处理的 PowerShell 错误会停止依赖语句，不再允许误导性成功输出。有意恢复的脚本必须表达错误处理；执行器不验证哈希、文件或声明。原生可执行文件状态、输出截断、期限、取消与进程所有权保持不变。持久终端会话属于独立提供方，此决策不改变它们。

真实进程测试覆盖插值失败、cmdlet 与嵌套脚本错误、显式处理、合法 stderr、原生退出码传递、后台完成及 Windows PowerShell 回退。可运行的 `examples/headless-agent/pwsh-error-status.cordis.yml` 场景将真实工具结果反馈给脚本化模型，并检查持久化会话证据，不调用外部模型。
