# Agent Note: Leon 默认 Windows workspace

Status: implemented

[English](2026-08-22-leon-default-windows-workspace.md) | 中文

## 问题

Leon 在 Windows 上需要一个可预测的项目目录，避免 Web 会话、一次性会话、文件系统工具与沙箱策略从不同的启动目录静默开始。同一策略还必须允许未来的安装程序配置，并能用于没有 `E:` 盘的宿主。

## 决定

`resolveDefaultWorkspace()` 是新会话路径与部署后备路径的唯一解析器。它依次接受显式路径、`$LEON_DEFAULT_WORKSPACE`、`$DSH_DEFAULT_WORKSPACE` 与 `$DSH_CWD`，并忽略空白值。没有覆盖值时，它在 Windows 上返回 `E:/computador`，在其他平台上返回调用目录。每个结果都是绝对路径；相对值以调用目录为基准解析，受支持的波浪号前缀通过共享路径辅助函数展开。

Web API 网关与 headless runner 将这个结果分配给新会话。base 沙箱策略、沙箱文件系统与 minimal preset 使用同一个解析器。客户端选择的 workspace 与会话已经持久化的 workspace 在会话创建后仍具有最终效力。

解析器不会创建所选目录。当前 Leon 机器与未来的 Windows 安装程序会在启动前创建目录；配置其他路径的操作者负责该目录及其权限。

## 验证

单元覆盖固定了覆盖值优先级、空白处理、路径规范化、波浪号展开与平台后备值。Loader 组合覆盖证明 `!!js` 配置项可以调用该解析器，headless 覆盖则证明解析后的路径会写入新会话的 Session header。配置验证检查随附组合包与 preset 表达式。

## 考虑过的替代方案

**所有位置继续使用调用目录。** 已否决，因为快捷方式、服务、终端与开发环境可能具有不同的调用目录，会使 Leon 在 Windows 上的可写项目根目录不可预测。

**在每个消费方中分别硬编码 `E:/computador`。** 已否决，因为这些副本可能逐渐分化，安装程序也必须修改多个包与配置文件。

**由每个运行时消费方创建目录。** 已否决，因为路径创建与权限设置属于安装或部署。库静默创建已配置路径会隐藏安装错误，并在多个进程中产生重复副作用。

## 后果

Leon 具有一个稳定的 Windows 项目根目录和一个面向安装程序的覆盖变量。现有的 `DSH_DEFAULT_WORKSPACE` 与 `DSH_CWD` 集成仍可在 Leon 专用变量之后继续使用。没有可用 `E:` 盘的机器必须在启动 Leon 前设置 `$LEON_DEFAULT_WORKSPACE` 或接收安装程序选择的路径；运行时会通过使用该路径的文件系统或进程操作报告失败，而不会把工作静默转移到其他位置。
