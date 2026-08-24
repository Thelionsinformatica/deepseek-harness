# `@deepseek-ai/dsh-base`

[English](README.md) | 中文

以 profile 组合包形式交付的共享 dsh 核心：[`cordis.patch.yml`](cordis.patch.yml) 在空的 profile 根之上插入全部基础插件行——模型适配器、共享的 [`agent-default-model`](../../core/agent-default-model/README.zh.md) 选择、工具、持久化、策略（包括[重复失败恢复 guard](../../guard/failure-recovery-policy/README.zh.md)）、settings／credentials、遥测与核心 spawn／fork subagent provider——作为每个 profile 的 `dsh.profile.bundles` 列表中的第一层。可选的 Codex 与 Claude Code provider 不属于本包及其生产依赖闭包；Profile 仅在需要时安装任一[产品 provider Bundle](../../subagent/README.zh.md)。因此，默认的 `@deepseek-ai/dsh` 生产依赖闭包既不包含任一产品 provider、Claude Agent SDK，也不包含 Codex wrapper 及其平台载荷。后续的组合包层（例如 [`dsh-web-app`](../web-app/README.zh.md)）和用户 profile 的 `cordis.patch.yml` 按 id 覆盖这些行；patch 会替换目标行的整个 `config`，因此模式专属的值放在各模式组合包中，而不是这里。该包没有运行时 API；profile 组合器通过 manifest（元数据清单）的 `dsh.bundle.patch` 字段解析 patch，绝不通过代码。

patch 在自身上按平台门控两个 shell 栈：`bash-sandbox`/`tool-bash` 携带 `disabled: !!js process.platform === 'win32'`（bash 没有 Windows runner），它们的孪生行 `pwsh-sandbox`/`tool-pwsh` 以取反的表达式仅在 win32 挂载——同一份 patch 文件，每个宿主恰好挂载一个 shell 栈。权限面与 POSIX 完全一致：`sandbox`/`sandbox-policy` 通过 Windows ACL 受限令牌 runner（`dsh-sandbox-local` 的 win32 链 → `@deepseek-ai/dsh-sandbox-windows-acl`）执行文件效果策略，权限切换器与 approval 服务原样运行，`fs-sandbox` 继续围栏 `ctx.fs` 写入——在其旁再挂载 `dsh-fs-local` 会重复注册 `ctx.fs` 并在加载时失败。偏好不受沙盒约束的本地 pwsh 执行器或完整访问的 Windows 主机通过其 profile 或 home 的 `cordis.patch.yml` 覆盖这些行（bash 恢复配方必须完整：禁用 `pwsh-sandbox`/`tool-pwsh` 并重新启用 `bash-sandbox`/`tool-bash`——两个执行器家族注册同一个 `bash` 服务，配方不完整会在加载时直接报错）。POSIX 主机看到的是被禁用的 pwsh 行。

行集合及其设计依据以行内注释写在 patch 文件里；[生成的组合图](../../../apps/cli/composition.md)负责渲染它。

base 组合包为后备沙箱策略与沙箱文件系统解析同一个部署 workspace。Leon 在 Windows 上的默认值是 `E:/computador`；环境覆盖值与非 Windows 后备值由 [`resolveDefaultWorkspace()`](../../util/home-paths/README.zh.md)负责。每个会话自身的 workspace 根目录在请求时仍会覆盖这个部署后备值。

Leon 随附两个本地 Ollama 角色：`ollama/qwen3.5:9b` 处理日常工作，`ollama/ornith-1.5:9b` 担任编程与 Agent 专家。仅回环地址可用的 `omniroute/auto` 网关与通过凭据引用的 `openai/gpt-5.6-terra` 路由可供显式部署故障转移策略使用；两者都不会改变 Leon 的身份。Gemini 仍是单独配置的路由。DeepSeek 模型与搜索适配器只作为手动兼容选项安装，不会挂载到随附目录。基础组合禁用面向模型的 Web 搜索与抓取；部署必须有意挂载提供方和相应工具，本地上下文才可能因检索而离开本机。

在 Windows 上，该组合包还通过通用 ACP subagent provider 公开一个项目范围的 `opencode` 委派工具。子进程使用 `E:/computador/.leon` 下的隔离 OpenCode 配置，以 Ornith 作为主要编程模型、Qwen 作为小模型，只继承所选 workspace 路径，并仅把最终文本返回给 Leon。其配置把文件操作限制在该 workspace 内，并拒绝 commit、push、hard reset、递归删除、外部目录访问及嵌套 Agent。

## 模型体验

通过插入的行间接产生影响：该组合包选定随发行版交付的无 persona 提示词基座、工具集合与供模式组合包特化的提供方路由，而每个插入包负责其自身的模型可见行为。

#### KV Cache 影响

无直接影响；每条插入行的影响由其所属的包负责。

## 已知限制与暂缓事项

- **patch 会替换整行 `config`**：profile 覆盖必须重述该行需要保留的每个字段；不存在深度合并层。
- **本地路由要求 Ollama 正在运行**：回环端点为 `http://127.0.0.1:11434/v1`，安装程序必须确保 Qwen 与 Ornith 均可用。
- **OmniRoute 是独立的回环服务**：其配置端点为 `http://127.0.0.1:20128/v1`；该路由会发送 OpenAI 兼容适配器所要求的非机密兼容 bearer header。生产启动必须把服务绑定到 `127.0.0.1`，并明确配置上游凭据与预算策略。
- **OpenCode 是由安装程序持有的 Windows 运行时**：默认命令与配置位于 `E:/computador/.leon` 下；部署环境变量可以覆盖这些路径，非 Windows 的基础组合会禁用该提供方。
- **Web 检索需要显式 profile 覆盖**：基础组合挂载提供方中立的 seam，但既不启用搜索提供方，也不启用面向模型的 Web 工具。只启用提供方而不启用工具，或只启用工具而没有可用提供方，都属于不完整的部署配置。
- **Windows 的临时目录授权是按会话的私有子目录**——`workspace-write` 把写入限制在工作区与会话自己的 temp 子目录（`<temp>\dsh-<hash>`，受限子进程的 TMP/TEMP 被改写）；`read-only` 不授予任何临时目录写入权限。见 `@deepseek-ai/dsh-sandbox-windows-acl`。
