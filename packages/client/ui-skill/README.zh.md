# @deepseek-ai/dsh-client-ui-skill

[English](README.md) | 中文

skill（技能）调用 source 的浏览器端：把 `/` 触发的 `skill` source 注册进 `ctx.inputTriggers`。普通会话的候选来自 `skill.list` RPC，以每次调用的 `ClientSessionContext` 投影中的 `{sessionId}` 寻址，host 从会话 header 解析 `cwd`。宿主提供每一个用户可调用的 skill；`modelInvocable: false` 的条目（即 `disable-model-invocation` skill，此路径是其唯一入口）会以当前语言把仅限用户标记作为描述前缀带上。由目录寻址的可继续 subagent 在客户端解析为没有 skill 候选，因为现有 skill RPC 要求会话已挂载；查看其持久化历史不得激活它。目录按普通会话缓存，拉取走 single-flight；scope 创建时的 `warm` 钩子预热该会话的缓存项，转发的 owner 事件 `agent-preset/selected` 丢弃该会话这一项（目录属于 preset，而空会话可能在预热之后才切换），`connection/reset` 清空全部缓存。结果按 `startsWith(query)` 过滤。

pick 会落下字面文本 `/name `，发出的提示词中也是同一段字面文本（[slash 流水线 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.zh.md)）——本 source 不实现任何裁决钩子，也没有引用 codec。确定性在宿主侧：pre-step 手势边界（`dsh-tool-skill`）识别用户消息中任意位置、以空白为界、指名用户可调用 skill 的 `/name` token，并为每个入口注入渲染后的 `<skill_content>`，因此菜单 pick、手动键入的 token 与 TUI/ACP（Agent Client Protocol）提示词都以同一种方式加载 skill。与宿主命令同名的名称仍解析为命令：裁决在客户端把该行认领走，它根本不会成为提示词——这是有意的优先级，与同类产品一致。列表 RPC 使用插件注册时捕获的根上下文连接——source 绝不从每次调用的参数上读取服务；草稿 chip 视觉由 `lexicon` 扫描派生。

`skill.list` 失败时 `candidates` 抛出异常，slash 壳层记录日志，并静默丢弃该菜单组——菜单只显示 pending／ready 状态。

`/client` 导出接口只有插件主体（`apply`／`inject`）；source 对象是注册 effect 的内部实现。

## 已安装技能设置

`Skills` 页面通过已有的 `settings.section` slot 注册到 `ui-settings`，使用 `skills.catalog` 列出本地技能，包括已禁用的条目。配置选择器读取 `agentPresets.list`；选择配置只改变本页查看的对象，不会改变默认配置或会话使用的配置。可选的工作区选择器使用 `useWorkspaces` 提供的已注册工作区 ID。不选工作区时，目录覆盖配置和用户根目录；选择工作区时，Host 解析其目录并纳入项目技能。本页不接受文件系统路径，也不会安装技能。

每个开关通过 `settings.mutate` 在 `agent-presets` 命名空间保存所选配置的禁用技能名称，并将目录的 `revision` 作为 `expectedRevision`。偏好按名称作用于该配置的所有工作区。写入会保留当前目录中未出现的禁用名称，等待 RPC 结果并重新读取目录，不会乐观地显示保存成功。被拒绝或结果不确定的写入不会自动重试。UI 区分不完整目录、已确认的空目录、只读设置、加载状态和错误。单个待结算写入会锁定控件；被替代的读取会被取消，无法覆盖较新的结果；插件销毁会等待待结算操作，且不再发布延迟状态。

启用技能不会放宽其模型／用户调用限制。更改影响后续目录查询和技能加载，不会移除对话中已经加载的说明。转发的 `settings/document-updated` 事件属于 `agent-presets` 时，会清空全部 slash 目录缓存，并刷新已经打开过的设置目录。重新连接也会执行相同处理。文案提供巴西葡萄牙语、英语和中文。

## skill 工具行

浏览器插件还会把 `skill` wire 名称注册进 `ui-tool` 的 keyed `tool.call.toolview` slot。收起的行以与 Bash 行相同的中性视觉层级显示 14 像素的 skill 文档与闪光组合图标、`Skill` 标题、分隔符和请求加载的 skill 名称；运行中的工具调用带有 transcript（文本记录）的扫光效果，失败时用错误首行替换名称，中断的工具调用则使用警告状态。已结算的行以整行作为展开入口，展开后显示一个尺寸受限的 `Instructions` 卡片，其中原样呈现持久化的工具输出；可用时还会提供标准执行轨迹的 `Inspect` 入口。该行的名称、生命周期和正文只派生自 `ui-tool` 提供的冻结的工具调用／工具结果切片，绝不读取当前 skill 目录，因此即使已安装的 skill 或其描述发生变化，回放仍保持稳定。

## 模型体验

### 用户显式 skill 调用

#### 模型看到的内容

用户消息原样到达模型，字面文本 `/name` 也包含在内。随后宿主的 pre-step 边界（`dsh-tool-skill`）把规范的 `<skill_content>` 块——与 `skill` 工具返回的 `renderSkillContent` 输出相同——作为注入的指令上下文追加在该步骤各项注入的末尾，最贴近模型的回答。加载是确定性的：模型无需被要求调用 `skill` 工具就能收到完整正文，目录也会告诉它不要重新加载已内联注入的 skill。

#### Token 影响

一次调用会把渲染后的 skill 正文作为注入上下文加进该轮次——成本与模型经由工具加载该 skill 相同，只是无条件支付，而非由模型自行裁量。浏览菜单、拉取候选以及设置目录读取或偏好写入都不调用模型，也不增加模型 token。可用性更改可能影响 Host 后续的技能组装，但不会改变已经加载的说明。

#### KV Cache 影响

仅追加：注入的消息落在可复用历史前缀之后。该包绝不改写较早的请求 token。

## 已知限制与暂缓事项

- **仅含工具结果的 history 页使用通用行**：键控分派要求配对的工具调用位于运行时窗口内；分页将工具调用留在窗口外时，工具结果没有工具身份。这项客户端呈现功能不会为了恢复该身份而扩展 history 协议约定。
- **文本是唯一依据**：引用是普通的草稿文本；手动键入的相同 token 就是同一个引用，宿主手势边界评判的是发出的文本，而不是菜单交互。chip 视觉由 lexicon 扫描派生；没有 occurrence 身份、位置跟踪，也没有提示词协议上的结构化引用载荷（两者都是台账事项）。
- **预热落定之前打开的菜单**：在那次击键下不显示 skill 候选；下一次击键会重新轮询已落定的缓存。
