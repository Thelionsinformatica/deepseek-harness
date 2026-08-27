# LEON-ACCEPTANCE-7

[English](leon-acceptance-7.md) | 中文

## 目的

LEON-ACCEPTANCE-7 是七项 Leon 能力的可执行产品验收参考：重启连续性、长期决定检索、精确 Windows 与 workspace 定位、由证据约束的完成、复用已审核流程、本地模型执行，以及透明的 API 成本核算。[`scripts/leon-acceptance-7-model.ts`](../../scripts/leon-acceptance-7-model.ts) 中的规范注册表把每项能力映射到精确的 Vitest 证据；当证据缺失、跳过、改名、部分成立或失败时，它会关闭式失败。

## 前置条件

- 使用带有 `pwsh` 的 Windows；UI Automation 证据是 Windows 原生能力，在其他平台会被跳过。
- 在字面 loopback 端点 `http://127.0.0.1:11434` 上运行 Ollama，或者把 `LEON_ACC_006_OLLAMA_URL` 设为不含嵌入凭据、主机为 `127.0.0.1` 或 `[::1]` 的 HTTP URL。
- 提供精确的 Ollama 模型 id `qwen3.5:9b` 与 `ornith-1.5:9b`。评估不会替换为别名或其他量化标签。
- 开始评估前安装仓库依赖。

运行前确认本地模型 id：

```sh
ollama list
```

## 运行评估

```sh
pnpm run test:leon-acceptance
```

协调器使用一个 Vitest worker 且不启用文件并行，将注册证据执行三次。每次重复都会启用仅限真实 loopback 的 Ollama 基准，它运行 30 个固定 PT-BR 微任务：22 个使用 `qwen3.5:9b`，八个使用 `ornith-1.5:9b`。因此，最小评估会执行 90 次本地模型推理。

使用 `--runs N` 可执行至少三次重复，使用 `--output <path>` 可选择聚合报告路径：

```sh
pnpm run test:leon-acceptance -- --runs 5 --output .artifacts/leon-acceptance-7/manual.json
```

## 执行保护

- 子进程会从继承的环境中移除 `DEEPSEEK_API_KEY`、`GEMINI_API_KEY`、`GOOGLE_API_KEY`、`NVIDIA_API_KEY`、`OMNIROUTE_API_KEY` 和 `OPENAI_API_KEY`。
- 真实模型基准只接受不带身份验证的 HTTP loopback Ollama 端点，并在调度前拒绝外部主机。
- 路由策略证据会在适配器运行前拒绝 Ollama 之外的任何初始提供方。
- Vitest 输出和失败详情不会复制到聚合产物；聚合结束后会删除每次运行的临时报告。

## 七项标准

| ID | 产品主张 | 可执行证据范围 | 关键 |
|---|---|---|---|
| LEON-ACC-001 | 在运行时重启并改变所选模型后恢复一个待处理任务。 | 在同一个持久会话上重建 agent，并证明只有待处理任务通过替代模型继续。 | 是 |
| LEON-ACC-002 | 数月后找到正确决定。 | 在新会话中让一项 150 天前的决定排在较新干扰项之前。 | 是 |
| LEON-ACC-003 | 操作预期窗口和 workspace，且不混淆相似目标。 | 要求精确窗口身份与进程允许列表，并另行要求 workspace id 与规范路径所有权一致。 | 是 |
| LEON-ACC-004 | 声明完成前测试并证明变更。 | 要求任务列表全部完成、一次新鲜的结构化审核、与被审核父日志绑定的摘要，并拒绝被篡改或陈旧的证据。 | 是 |
| LEON-ACC-005 | 学习已审核的成功工具流程，并在切换模型后复用它。 | 仅从成功的 `tool/call` 与匹配的成功 `tool/result` 构建并持久化候选；人工批准会在提升或复用前绑定精确命令，随后新会话与新模型在持久前置条件和重新验证状态约束下检索并实际执行步骤与验证器。 | 否 |
| LEON-ACC-006 | 为代表性 PT-BR 任务使用本地模型。 | 证明 30 条初始 Ollama 路由，并在每次重复中用精确微任务 oracle 验证 30 个真实 loopback 模型答案。 | 否 |
| LEON-ACC-007 | 分别显示已确认、按 token 估算和未核算的成本。 | 分别投影提供方报告费用、已配置 token 估算、未知调用与 retry/failover 尝试，并验证其 StatsLine 展示。 | 是 |

## 产物与保密性

协调器默认以原子方式写入 `.artifacts/leon-acceptance-7/latest.json`。它包含运行时元数据、已移除凭据键列表、运行次数、稳定性、标准状态、证据身份、耗时、已命名缺口，以及缺失或失败证据。它不包含提示词、模型响应、会话内容、凭据、堆栈跟踪、workspace 路径或窗口内容。

真实 Ollama 证据另行写入 `.artifacts/leon-acc-006/local-real-latest.json`。该产物包含任务 id、所选本地路由、通过状态、延迟、token 数量、错误代码，以及每个规范化答案的 SHA-256 摘要；它不保留提示词或答案文本。

## 结果语义

只有当每个映射测试在每次重复中通过、至少一个映射测试属于决定性证据，且注册表没有命名剩余缺口时，一项标准才是 `passed`。缺失、跳过、待处理或失败的证据会让标准成为 `failed`；只有辅助证据或存在已命名缺口会让它成为 `partial`。只有至少三次稳定重复、七项标准全部通过且没有部分标准时，聚合结果才获批准。

精确文件与测试名称映射是有意设计。若在不更新已审核注册表的情况下改名或移除证据，结果会显示证据缺失，而不会静默削弱主张。当决定性用例 `learns reviewed successful tool evidence and reuses exact steps after a model switch` 已注册并通过时，LEON-ACC-005 不再保持部分状态：该用例证明显式候选、审核、持久化、模型切换后的检索与经验证执行，以及重新验证流程。

## 解释限制

30 个 Ollama 用例是确定性的单答案微任务。它们证明本地路由和受约束响应质量，不证明 Leon 能完成检查项目、编辑文件、调用工具、从失败中恢复并验证最终结果的长期自主工作流。

成本投影会区分提供方报告金额、已配置的 token 价格估算，以及缺少充分成本证据的活动。它不会查询或核对提供方发票、账户账本、税费、额度、协商价格，也不会核对提供方未报告的费用。

流程候选目前需要显式创建，而不是自动生成；Leon 也尚无专用审核界面。这些是可用性与自动化限制，但不会使显式已审核流程的决定性证明失效。

UI Automation 证据依赖原生 Windows 可访问性与 PowerShell 行为。非 Windows 运行会跳过该决定性用例，因此无法批准 LEON-ACC-003 或完整聚合结果。

三次重复会在一个串行测试配置下暴露缺失证据与运行级不稳定。它们不证明长期可靠性、跨硬件性能，也不证明更换模型或量化版本后不会出现模型输出波动。

测试决定与被否决替代方案记录在 [LEON-ACCEPTANCE-7 Agent Note](../../.agents/notes/implemented/testing/2026-08-26-leon-acceptance-7.zh.md) 中。
