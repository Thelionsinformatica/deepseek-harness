# Agent Note: Leon 迁移到 DeepSeek Harness 0.2.2

Status: implemented

[English](2026-10-29-leon-replatform-onto-0-2-2.md) | 中文

## 问题

[0.2.1 迁移](2026-10-09-leon-replatform-onto-0-2-1.zh.md)让 Leon 停留在 `dsh-v0.2.1-alpha.2` 标签上。到 2026-10-28，上游已发布 `dsh-v0.2.2-alpha.2`，期间跨越 3,166 个提交和八个标签（`0.2.1-alpha.3`、`alpha.4`、`alpha.5`、`rc.1`、`rc.2`、`rc.3`、`rc.4`、`0.2.2-alpha.2`）。`leon/replatform-0.2.1-alpha.2` 领先 15 个提交、落后 3,166 个提交，所以合并仍然不是正确的形状，分叉会继续扩大。

0.2.2 线改动了迁移工作所依赖的四个接缝：

- `SessionProjections.stateOf(session, key)` 已废弃并返回 `unknown`；单元只能通过等待注册句柄读取（`handle.stateOf(session)` / `handle.readerFor(session)`）。
- 工具批次从每次调用 `ToolsService.execute({ callId, name, arguments, signal })` 改为 `ToolBatchInput { calls, signal }` / `ToolBatchResult { results, … }`，测试入口是 `executeToolFixture` 与 `executeModelToolFixture`。
- `defineContentToolFixture` 从 `@deepseek-ai/dsh-tools` 移到 `@deepseek-ai/dsh-tool-testkit`。
- `KvTable` 新增 `deleteMany`，凭据文档现在容忍外部写入的顶层键（`ignoredKeys`），而不是直接拒绝。

## 决定

Leon 在全新工作树中基于 `dsh-v0.2.2-alpha.2` 重建，分支为 `leon/replatform-0.2.2-alpha.2`，并按与上次相同的分层迁移 `leon/replatform-0.2.1-alpha.2` 的 15 个提交：先迁 Leon 独有包，再迁 Leon bundle 与预设，然后迁对上游文件的修改，最后重新生成文档。

15 个 Leon 独有包（`packages/bundle/leon`、`client/language-pt-br`、`client/ui-web-access`、四个 `guard` 策略、`knowledge/tool-knowledge-base`、六个 `memory` 包、`web/web-access`）原样复制，只做 0.2.2 约定要求的改动：`SessionProjections.register` 在异步 `apply` 或 `[Service.init]` 中被等待，句柄拥有每一次读取；测试夹具改为从 `dsh-tool-testkit` 导入；`KvTable` 实现补上 `deleteMany`。

对上游文件的修改是重新施加的，而不是合并：

- `credentials-local` 在 0.2.2 的文档规则之上保留 Leon 的 Windows DPAPI 版本 2 信封：未知顶层键被保留并告警，`resolve`/`describe` 优先使用受管存储而不是继承的环境，`assertUnshadowed` 被移除。
- `storage-domain` 让上游的 `deleteMany` 与分叉的 `KvTable.mutate()` 并存。
- `official-bundles` 在 `OPTIONAL_BUNDLES` 中列出 `@deepseek-ai/dsh-leon`；分叉原先扩展的 `PROFILE_TEMPLATES` 块现在位于该包中。
- `app-boot/profile.ts` 不再需要任何分叉修改。
- 门禁脚本（`check-workspace-constraints`、`gen-doc-graphs`、`gen-tool-catalog`、`verify-package-readme-model-experience`）保留 0.2.1 中所加的 Leon 行。

所有工作区清单都携带根版本 `0.2.2-alpha.2`，因为 `check-workspace-constraints` 会拒绝任何与根版本不一致的 dsh 系列清单。

## 考虑过的替代方案

**把 `upstream/master` 合并进 0.2.1 分支。** 0.2.1 的记录已经测出直接合并会产生 858 个冲突路径；3,166 个提交的差距只会更糟，而且投影、批次和夹具 API 仍需要同样的修改。

**留在 0.2.1 上挑选修复。** Leon 会继续漂移，而且投影废弃警告会在每次读取时出现。

**只迁包、跳过上游文件修改。** Leon 配置挂载的内存和防护服务依赖 `storage-domain` 的 `mutate` 原语和凭据信封，因此分支能激活但行为不正确。

## 后果

- 已部署的 0.2.1 构建继续运行，直到迁移分支通过验证；不会自动切换。
- 生成的目录（`tool-cordis/src/api-catalog.ts`、`docs/tool-catalog.md`、文档图、bundle 与插件目录、技能包参考）从迁移后的源码重新生成，而不是合并。
- 每个迁移包保留自己的 `stateVersion`；投影句柄按插件持有，因此同一键的第二次注册仍会显式失败。
- `apps/desktop` 构建在产出安装包之前仍需要单独验证。

## 验证

- `pnpm run build` 通过全部十项构建门禁：原生附加组件、Host Typert、host 与 client 编译器、host 与 client bundle、desktop bundle、两个聚合检查，以及 Web 构建。
- `pnpm run typecheck` 通过全部五项门禁，`pnpm run lint` 报告零错误。
- `pnpm install` 以 15 个迁移清单解析全部工作区项目，每个迁移包的 `@deepseek-ai/*` 依赖都能在工作区内解析。
- 聚焦包测试以 `vitest run packages/memory packages/guard packages/knowledge packages/web/web-access packages/credentials/credentials-local packages/storage/storage-domain packages/mcp/mcp-client` 运行：56 个文件、919 个测试通过。MCP 协商生命周期用例在并行负载下对时序敏感，单独运行时通过。
- 生成的目录通过 `gen-cordis-catalog`、`gen-doc-graphs`、`gen-tool-catalog`、`gen-plugin-packages`、`gen-official-bundle-catalog`、`gen-config-catalog`、`gen-persistence-catalog`、`gen-tsconfig-paths` 和翻译配对写入器刷新。
- `pnpm run doc-sync` 通过与代码树相关的全部门禁。两项门禁依赖机器本身：`verify-repository-references` 把 `python/sdk/uv.lock` 中一个七位数的大小字面量与本地克隆的对象数据库比对，而它现在与某个提交前缀碰撞；文档站点测试需要创建符号链接，在 Windows 上需要 `SeCreateSymbolicLinkPrivilege`。
