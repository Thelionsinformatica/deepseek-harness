# Agent Note: 基于真实工作区投影的 Leon Work 仪表板

Status: implemented

[English](2026-08-22-leon-work-dashboard.md) | 中文

## Problem

Leon 需要一个更接近 ChatGPT Work 感受的工作型起始表层，同时保留现有的本地优先会话体验。通用空会话 Hero 之前只提供标识、工作区选择和 composer。把产品卡片硬编码进 conversation 包会使 Leon 专属呈现与可复用的领域壳耦合，而显示虚构的 GPU 或提供方状态，则会错误表达浏览器目前无法观测的状态。

## Decision

conversation 包在 Hero 标题与工作区控件之间声明一个可选的根作用域 `conversation.hero.dashboard` slot。新的 `ui-work-dashboard` 产品包在发布的 Web 组合中占用该 slot。移除这个包即可恢复此前的 Hero，无需修改 conversation 包或其常驻 composer。

仪表板的每个数字卡片都来自现有 Workspace 与 Session 投影：已连接工作区、正在运行的普通未归档会话、等待用户交互的会话，以及已完成但尚未打开的会话。最近工作列表采用最近更新的三条非空、未归档、非 subagent 会话。开始工作和打开最近工作均委托给所属的 Workspace 与 Session runtime，而不复制导航状态。

本地优先卡片只作说明，并把用户指向现有的当前模型 composer 芯片。由于尚无这些事实的权威浏览器投影，它不会声称本地模型、GPU、Ollama 服务或云 API 处于健康状态。产品文案以巴西葡萄牙语原生编写，并提供完整的英文和简体中文词典。

## Alternatives considered

**直接在 `ui-conversation` 中构建仪表板。** 否决，因为卡片、Leon 文案与产品路线并非会话域的不变量。slot 让通用壳保持可复用，并允许通过组合整体移除仪表板。

**用单独的仪表板路由替换应用框架。** 首个里程碑否决此方案，因为它会复制或中断已经工作的侧边栏、空会话 composer 与会话转换。可选 Hero occupant 能提供连贯的起始表层，而不拆分导航。

**显示占位的 GPU、Ollama、记忆和 API 健康状态。** 否决，因为美观但虚构的状态会削弱信任。这些卡片进入仪表板前，需要明确的运行时投影及各自的失败语义。

## Testing

组件测试固定真实指标推导、从最近工作中排除已归档／空白／subagent 行、最近顺序、空状态、任务启动和最近会话导航。浏览器插件测试在真实 SlotRegistry 上固定声明顺序、locale 与操作注入、HMR 折叠和资源释放。conversation 测试固定新的根作用域 slot 与 Hero 渲染调用。组装 Web 场景启动发布组合，在全新环境中观察仪表板，通过现有 picker 连接工作区，并验证实时项目数量，同时不出现控制台修复警告或页面错误。

## Consequences

Leon 现在以紧凑的工作概览打开，而同一个 composer 仍是开始并执行任务的位置。首个里程碑在不引入第二事实来源的情况下改善连续性与可发现性。实时模型提供方健康状态、产物聚合、计划任务、记忆审查与权限审计仍属于后续里程碑，并且每项都必须以权威投影和测试为前提。
