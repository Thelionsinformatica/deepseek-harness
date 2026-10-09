# Agent Note：Leon 分离历史、记忆、知识与显式目标

Status: implemented

[English](2026-08-28-leon-context-continuity-and-target-preservation.md) | 中文

## 问题

Leon 可能只检查空的 workspace memory 或 personal memory 后便回答自己什么都没有学到，即使先前的 session log 和外部 `.leon/knowledge` 知识库实际存在。默认文件系统 MCP server 只暴露 Leon 源代码仓库；当显式指定的外部路径被该工具拒绝时，模型会静默改用仓库并报告无关结果。Web 组合中的 session 全文搜索也保持关闭，因此模型无法通过历史查询发现已经完成的工作。

检索到的 session 文本本身可能包含过时或对抗性指令。如果没有明确的信任边界，历史摘录可能声称有权替换用户当前的目标。先前的访问指引还把技术故障与用户、审批、sandbox、权限和策略拒绝归为一类，因此拒绝可能错误地触发另一个工具或等价路径。

自适应路由 shadow 还把当前模型声明的质量和始终可见的工具 schema 数量当成每个请求都需要专家质量的证据。这导致简单提示也得到饱和的被动建议，并把目录规模误当成任务难度。

本地模型还可能只输出内部 reasoning 或空白文本便停止。adapter 正确保留了这些内容，但 agent 随后因没有 tool call 而把轮次关闭为已完成，用户只看到 thinking 行而没有答案。与原样重复请求相比，一条明确要求可观察 tool call 或最终响应的日志续行更可靠。

## 决策

Leon 现在把 session 历史、workspace memory、personal memory 和 `.leon/knowledge` 视为独立来源。persona 要求在回答学到了什么或完成了什么之前查询适用来源，空结果只适用于被查询的来源。`leon-knowledge-base` skill 为 `index.md` 和 `wiki/**/*.md` 增加有界只读 `search` 操作；它排除原始证据、日志和 schema 文件，强制 canonical path containment，限制文件数与输出，在排序前过滤常见葡萄牙语回忆词，并可接受显式外部 workspace 而不把它导入其他记忆域。

稳定的跨工具指引保留在各 package 自己的 prompt section 中，而 Leon persona 只承载身份、来源选择、隐私、目标、拒绝、Web 与提醒策略。可配置的查询上限仍同时出现在工具 schema 和精简指引中。组装后的 preset 在 32,000 字节的静态启动预算内设置 31,200 字节上限，因此 catalog 增长若会静默占用 800 字节的保留容量，E2E 会直接失败。

Web 组合把派生 session 索引存放在 DSH home 下，并只在首次搜索时打开 SQLite。Leon 暴露用于查找先前工作的 `session_search`，以及用于在压缩或模型切换后进行有界恢复、仅含查询参数的 `current_session_search`。后者始终以调用方为目标，并在调用步骤前停止，不公开 session id、原始事件读取、trace 或过滤控制。Windows 盘符路径会忽略大小写和分隔符差异进行匹配，而 provider 仍只接收观察到且已授权的精确写法。其他 preset 通过 `enabledTools` 选项继续保留五种通用操作。

固定仓库根目录的 filesystem MCP 示例仍保留在配置中，但在 Leon 默认目录里被禁用。原生文件系统和 PowerShell 工具继续支持经授权的绝对路径访问，persona 要求跨轮次保留用户的显式目标。Leon 可以在同一目标上诊断技术访问故障，但用户或策略拒绝会停止该操作。两种结果都不能证明目标不存在。

`session_search` 的提示词指引和每个非空结果都将检索到的历史标记为不可信数据，而不是指令或授权。只有用户的直接请求才会更改活动目标。Leon 区分可重试的技术故障与用户或策略拒绝：拒绝会停止该操作，不会重试、更换工具、绕过、升级或选择等价路径。知识和 Windows Skill 应用同一规则。当用户的直接消息命名或确认其精确绝对路径时，外部知识 workspace 仍有效；历史、记忆、文档和工具结果都不能授予该权限。

自动外部故障转移授权会记录其覆盖的最新 durable session event。之后任何受保护的本地检索——包括文件、shell、代码导航、memory、session 历史、图像、附件、browser/desktop 状态、Skill 和 subagent——都会使授权失效。已经激活的外部故障转移会在每一步前重新验证；授权过期时回到最后的本地路由，并通过第二次检查关闭异步组装竞争。仅公开内容的 `web_search` 和 `web_fetch` 不消耗授权。再次保存授权会显式覆盖扩展后的上下文；Host 重启仍会撤销全部授权。

被动路由 shadow 现在只从结构性请求压力推导最低质量：输入 token、消息数量和图像模态。可见工具数量仍参与 tool-loop token reserve，但当前路由声明的质量和目录规模都不再提升请求质量层级。自动模型安全冻结保持不变：在专用模型通过长时自主验收之前，所有自动本地层级继续使用 Qwen 3.5 9B。

共享 failure-recovery policy 会观察 `agent/turn-stopping`，并把 reasoning 加空格或不可见 Unicode 格式字符视为缺少最终输出。其兼容性默认值为零，而 base 部署会显式启用一次活动路由上的日志同轮续行；部署最多可选择三次。续行要求模型执行所需工具或提供面向用户的答案，而不重复计划。非空白文本、tool call、扩展 block 和 `max-tokens` 结果保留普通语义。恢复消息从最近一次直接用户输入之后开始计数。配置次数耗尽后，`llm/stream` wrapper 会把再次出现的空成功 finish 转换成稳定的 `NO_FINAL_RESPONSE` 错误 finish，而不会从 turn-stopping listener 抛错或短路其他 listener。该续行不会选择其他模型，也不会授权外部 provider。

知识查询会先使用有界 `knowledge.mjs search` helper 和用户命名的精确 workspace，再考虑原生文件系统发现。它不会把显式绝对 workspace 替换为 `.`，不会递归枚举 `.leon/knowledge`，也不会批量读取 `raw/`；只有相关 wiki 页面链接的来源才能用于确认重要声明。prior-session 查询没有匹配时，会用一到两个有区分度的术语进行一次更短查询，然后才把该来源报告为空。

Leon 现在把 `knowledge_status` 和 `knowledge_search` 挂载为面向模型的专用工具，并由同一个固定 helper 契约支持。当直接授权的外部知识目标被锁定时，explicit-target policy 会阻止通用文件系统、shell、编辑器、图像和 terminal 工具被当作替代路径。知识轮次只有在当前轮次中，每个已配置必需工具都针对每个授权目标拥有持久化的 root-model `tool/call` 和最终成功的 `tools/result` 后，才能成功完成。嵌套调用、extension 直接调用、失败结果和 post-execute 重写都不能满足契约。插件 remount 后会从持久事件重建进度；系统只进行一次有界纠正，若模型仍未完成，则以 `REQUIRED_TOOLS_MISSING` 结束，而不是产生虚假成功。

## 验证

聚焦 Vitest suite 覆盖有界知识搜索、自然语言排序、workspace 隔离、重定向路径逃逸阻断、可选择的 session-query 注册、Windows 路径别名、当前 session 截断和无效配置。必需工具 suite 还覆盖持久化 root 调用、最终结果重写、多目标完成、外部调用误判、remount 重建、有界纠正和稳定终止错误。对抗性历史 fixture 尝试把目标重定向到另一个驱动器；渲染结果先放置信任边界，provider 请求仍固定在调用方 workspace。故障转移测试会把合成秘密注入受保护的本地检索来源，并证明过期授权不会产生任何外部路由解析或下一步调用；测试还覆盖活动路由竞争、新的显式授权和公开 web 结果。恢复测试覆盖 reasoning-only 与 whitespace-only 续行、有效文本与 tool-call 完成、`max-tokens`、持久逐轮上限和明确终止错误。路由测试覆盖大工具目录下的简单提示与长上下文升级。Leon preset E2E 检查两个紧凑历史工具、误导性固定 MCP namespace 的缺席、支持绝对路径的原生工具存在、信任与拒绝指引、精确 workspace 知识流程以及保守的静态上下文预算。

最终通过之前，可见验收暴露了两个真实缺陷：第一次运行到达专用知识工具后又退回通用 `read` 和 `glob`；第二次只输出计划，未调用工具便停止。这些失败促成了确定性的通用工具阻断和必需工具完成契约。重新构建并重启 host 后，一个新的 Leon Automatic session 在显式选择的外部 `.leon/knowledge` 根目录上调用一次 `knowledge_status` 和七次 `knowledge_search`，确认恰好五个活动来源，没有使用通用文件系统或 shell 工具，生成了面向用户的答案，始终使用本地 Qwen 3.5 9B，并显示预计 API 成本 `US$0.00`。功能验收通过，但该运行耗时 71 秒，并消耗约 103K 输入 token / 49% 上下文，因此重复搜索效率仍是量化的改进项，而不是已完成成果。聚焦的 75 项测试、lint、runtime closure、workspace constraints、Cordis 配置验证、聚焦 Leon preset E2E 和 host library build 均成功完成。

## 考虑过的替代方案

**把外部知识库复制进 personal 或 workspace memory。** 已拒绝，因为这会抹去来源、混合隐私域、复制源材料，并让纠正或删除变得含糊。

**把操作员特定的工作区硬编码为全局文件系统根目录。** 已拒绝，因为私有且机器特定的路径不可移植，应只为相关任务显式选择。

**向知识脚本添加独立的 `--authorized` 开关。** 已拒绝，因为该脚本不接收经身份验证的对话来源；提供路径的模型也可以提供该开关。因此，权限保留在能够区分直接用户消息与检索数据的 agent 边界。

**向 Leon 暴露每一种 session-query 操作。** 已拒绝，因为先前 session 发现加上仅含查询参数的当前 session 恢复工具可以保留本地上下文预算；需要时，启用其他操作的 profile 仍可获得精确 event 读取与 trace。

**在文件系统访问被拒后故障转移到云模型。** 已拒绝，因为 `ACCESS_DENIED` 是工具或授权故障，不是 provider 故障，不能静默跨越本地到外部的隐私边界。

## 后果

Leon 可以发现先前工作，并在当前 session 中恢复较早上下文，而不再假装所有知识都在一个存储中；它会保留用户命名的目标而不是退回仓库。历史文本仍可作为证据，但不会变成控制通道。拒绝会结束尝试的操作，而不会促使模型搜寻替代工具。本地模型只计划而不行动时会收到一次有界纠正，任务不再能够静默显示为已完成；如果仍缺少必需证据，轮次会明确失败，而不会被报告为完成。历史数据库是可重建的派生数据，不是 canonical source。外部知识仍按精确路径选择加入，不会自动注入每次对话。外部故障转移仍可使用，但受保护的本地检索会要求用户为扩展后的上下文再次保存授权。专用知识界面保护来源和目标边界，但查询次数效率仍部分取决于模型行为，需要单独的验收预算。双工具历史界面优先保障本地上下文经济性，而其他 preset 可以选择更广的 API。
