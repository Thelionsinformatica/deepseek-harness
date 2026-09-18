# Agent Note: 显式集体运行时桥接

Status: implemented

[English](2026-09-12-explicit-collective-runtime-bridge.md) | 中文

## Problem

产品 CLI 需要面向操作者的原生集体实验室入口，同时不能导入私有实验包、改变普通 profile，或将演示当成执行证据。

## Decision

显式指定运行时、组合配置、workspace、操作和限定的 `import-idempotency` 场景后，才能启动独立 Node 进程。发布启动器校验本地绝对路径、拒绝任意任务文本，并原样转发运行时输出与退出码，不合成结果。运行时和组合配置文件是可信操作者输入，不是模型生成的可执行附件。桥接不注入 TypeScript loader、包安装或 shell。子进程只继承操作系统路径／临时目录变量和固定的本地占位符，不继承提供方凭据、Node 选项或用户的 Harness home。

没有显式运行时的调用继续受[预览拒绝](../bug-fix/2026-09-12-collective-preview-refuses-execution.zh.md)约束。Dry-run 始终优先，不会执行子进程。原生持久化、权限、有界推理和完成校验仍由实验室运行时负责。中断会等待子进程关闭并返回取消码；只有显式运行时 STOP 操作负责持久取消。

## Alternatives considered

**在发布 CLI 中导入实验包** 会使私有原型成为生产依赖，并允许普通启动意外挂载它。

**通过桥接运行任意任务文本** 暗示固定导入场景并未实现的通用任务支持。操作者必须选择受支持的场景。

## Consequences

桥接允许显式本地集成，而不提升实验室的发布地位。清理环境变量减少环境凭据暴露，但不构成文件系统或操作系统沙箱。运行时信任、模型质量、STOP 持久性和任务证据需要独立验证。源码入口子进程测试覆盖精确参数、继承输出、非零退出码、无效路径、dry-run 优先级和中断；脚本化 JavaScript 子进程不能证明模型能力。
