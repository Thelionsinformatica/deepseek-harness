# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 是 Leon 用于启动提供方中立 profile 的兼容命令；profile 由多个插件组合包 patch 层按顺序叠加而成，其上再应用用户自己的覆盖配置。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh doctor` | 在不更改文件、服务、凭据或网络配置的情况下检查 Leon 本地运行就绪状态。 |
| `dsh backup [file]` | 规划或创建包含 Leon 权威状态的加密离线包。 |
| `dsh restore <file>` | 验证恢复包，或将其恢复到新的 Harness home。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

新的 Leon 会话在 Windows 上使用 `E:/computador` 作为 workspace 根目录。安装程序或操作者可通过 `$LEON_DEFAULT_WORKSPACE` 选择其他目录；完整优先级与非 Windows 行为由 [`resolveDefaultWorkspace()`](../../packages/util/home-paths/README.zh.md)负责。`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

<a id="diagnosis"></a>

## 诊断

`dsh doctor` 检查受支持的 Node 运行时、Windows 上的 PowerShell、Harness home、选中的已安装 profile、默认 workspace、已构建启动器、配置的 Ollama endpoint 与自动路由模型，以及预期的 Leon Web 端口。该命令只执行只读路径探测和有界 GET 请求；不会启动或初始化 profile、写入修复、启动服务或读取凭据值。警告保持退出状态 0；安装失败或预期端口被非 Leon 服务占用时以 1 退出。支持与安装程序自动化可使用 `--profile <name>`、`--port <port>` 或 `--json`；确切报告约定以 [CLI 行为参考](reference/README.zh.md#diagnosis)为准。

<a id="encrypted-recovery"></a>

## 加密恢复

`dsh backup --dry-run` 会清点并哈希恢复包将包含的状态，但不会询问密码或写入文件。完全停止所有 Leon Web 与 headless 进程后，`dsh backup --confirm-stopped` 默认会在 `<workspace>/Backups/Leon` 下创建经过认证的 `.leon-backup` 包。也可以用位置参数提供目标路径。

加密 payload 包含持久会话、已接受和候选记忆、workspace 注册信息、反馈与恢复状态、原始附件对象、设置／人格、用户指令、skill、preset，以及 profile manifest／patch。受管凭据存储及命名的 `.env`／`.npmrc`／密钥文件、匿名遥测 id、派生缓存、profile 依赖、workspace 内容、代码仓库、可执行文件和模型权重均被排除。会话及其他用户编写的文件仍可能包含曾粘贴进去的秘密，因此加密本身就是保密边界。加密 manifest 会记录原 workspace 引用和尽力获取的本地 Ollama 模型清单，供安装程序单独重建。

`dsh restore <file>` 会解密并验证每条认证记录，且不更改文件系统。只有在预览通过后，才添加 `--apply --confirm-stopped`，将状态发布到一个尚不存在的 Harness home；v1 永远不会合并或替换现有安装。源 Leon 版本必须与执行恢复的启动器一致，凭据需要重新登记。密码默认通过隐藏式终端提示读取；`--passphrase-stdin` 仅供可信安装程序或自动化管道使用，密码从不通过 argv 或环境变量接收。范围与限制详见[恢复约定](reference/README.zh.md#encrypted-recovery)。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.zh.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI（命令行界面）行为参考](reference/README.zh.md)为准。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.zh.md#source-execution)为准。
