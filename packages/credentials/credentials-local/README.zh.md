# dsh-credentials-local

[English](README.md) | 中文

文件型[凭据](../credentials/README.zh.md)提供方：四层来源，一套明确的优先级。

| 层 | 来源 id | 可写 | 优先 |
|---|---|---|---|
| 继承的进程环境 | `env` | 否 | 始终优先 |
| `$DSH_HOME/.credentials.yaml` 文档 | `file` | 是（`set`/`unset`） | 高于两个 `.env` 层 |
| `<invocation cwd>/.env` | `project-env` | 不在此处 | 高于用户 `.env` |
| `$DSH_HOME/.env` | `user-env` | 不在此处 | 其余情况 |

启动环境优先，因为按次覆盖（`DEEPSEEK_API_KEY=… dsh`、CI 机密、容器 `-e`）代表本次运行的操作者意图——而它无法从进程内部修改，就必须*可见地*只读：`describe()` 报告 `source: 'env', writable: false`，`set`/`unset` 直接拒绝，而不是写下一个读取方永远看不到的变更。

它之下的所有来源优先级都低于受管存储，因此 Models 页写入的密钥会立即生效，即使某个 `.env` 里还留着更旧的密钥。没有存储任何东西时这两层仍会参与解析，`describe()` 会把来源报告为 `project-env` 或 `user-env` 且 `writable: true`——存入一个密钥就会取代它们成为生效来源。

在产品 CLI（命令行界面）下，解析读取的是启动器冻结的[环境快照](../../util/launch-environment/README.zh.md)而不是 `process.env`：只有快照才说得清某个值来自启动 shell 还是来自某个文件。并非由产品 CLI 启动的组合只有继承环境这一层，这让嵌入方保持它们原有的语义。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | `<harness home>/.credentials.yaml` | 凭据文档位置。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | `path` 缺省时使用的 harness home。 |
| `watch` | `true` | 热发布外部编辑。 |
| `debounceMs` | `100` | watcher 写入稳定窗口。 |

## 文档本身

逻辑存储是一个带版本的 YAML 文档，每个键空间一个分节，除此之外别无他物：

```yaml
version: 1

refs:
  DEEPSEEK_API_KEY: sk-…
  OPENAI_API_KEY: sk-…

records:
  llm-pi-ai/openai-codex:
    kind: grant
    payload:                    # written verbatim; this provider does not interpret it
      type: oauth
      access: eyJhbGciOi…
      refresh: rft_9f8e7d…
      expires: 1786000000000
  llm-pi-ai/amazon-bedrock:
    kind: api-key               # environment values, no key: this route uses an AWS profile
    env:
      AWS_PROFILE: prod
  llm-pi-ai/amazon-bedrock-dev:
    kind: api-key               # neither: the owner confirmed the ambient credential chain
```

POSIX 在仅属主可访问的权限下直接存储这份版本 1 文档。Windows 则把整份逻辑文档作为版本 2 信封的 payload 存储：

```yaml
version: 2
protection: windows-dpapi-current-user
payload: "<opaque DPAPI blob encoded as canonical base64>"
```

payload 使用 Windows 数据保护 API（DPAPI）的 `CurrentUser` 范围和本包专用的可选熵进行保护。文件静态存放时，其中的凭据名称、值、记录和注释均不可直接读取。每次保护所得结果都会先在内存中解密并比对，然后才执行原子替换；保护、解密或比对失败都会中止写入，不替换上一份文档。

该文档只存放凭据，因此任何偏离都是拒绝，而不是跳过某个条目——被静默忽略的键读起来就是「我存进去的凭据没有生效」。非 mapping 的根、未知的顶层键、在其空间中不可寻址的键、类型不符的值、空字符串、未知的记录标签或字段、重复键以及格式错误的 YAML 全部失败：启动时明确报错，运行期热重载则告警并保留最后可用快照。

`grant` 的 payload 必须能经受 JSON 往返，读写两个方向都强制。YAML 能拼写出 JSON 没有的值——`.inf`、别名环——拥有者也可能递来 `Date` 或 `bigint`；无论哪种，存储都选择拒绝，而不是存下一个自己无法逐字读回的东西。

发布前的旧布局是没有 `version` 的扁平 mapping。启动时若能精确识别它——可寻址名称对非空字符串标量、且没有文档指令——就在写锁下升级：原有各行逐字下沉到 `refs:` 之下，值、注释与拼写逐字节保留。在 Windows 上，同一套加锁迁移既接受该扁平布局，也接受版本 1 文档；它先校验，再保护并验证，最后只原子提交版本 2 信封。迁移失败会让明文源文件逐字节保持原状，并中止激活。并发启动会在取得锁后重读，因此若另一进程已经完成信封写入，本进程直接使用而不重复改写。无法被识别器证明为旧布局的扁平形态会被拒绝，绝不当作空存储读取。

写入是对已解析的逻辑文档打补丁而不是重建，因此无论在 Windows payload 内还是 POSIX 文件中，注释与所有未触及条目的排版都会保留。直接位于某条目上方的注释属于该条目的注解，会随它一起删除。每次写入都先在 [`dsh-atomic-write`](../../util/atomic-write/README.zh.md) 的跨进程写锁下重读文档、把此前未观察到的一切发布出去，再在仅属主可访问（`0700`）的目录下以 `0600` 权限原子提交——因此并发写入者、或落在 watcher 防抖窗口内的外部编辑会被并入，而不是被覆盖。磁盘上已经无法解析或解密的文档会让写入失败，而不是覆盖提供方读不懂的内容。

任何字符串值都能往返，包括多行值，因此不会再有条目因为缺少可用引号样式而不可写。空的存储值等于不存在（seam 规则）——这也正是文档中的空字符串被直接拒绝的原因：`unset` 删除键，而不是把它置空。

## 权限

提供方以 `0700` 创建目录，以 `0600` 创建或原子替换文档。它对*读取*同样守住这条界线：在 POSIX 上，只要文档带有任何 group 或 other 权限位，就会在解析其内容之前失败——启动时与每次 reload 都检查——并在错误里给出 `chmod 600` 的修复命令。Windows 没有可检查的 POSIX mode，因此在那里跳过该检查而不是伪造它；DPAPI 把受保护 payload 绑定到当前 Windows 用户，复制信封并不会仅因别处的文件 ACL 可读就得到明文。

## 热重载

外部编辑在快照**整体替换**后按变更引用逐个发布 `credentials/reference-updated`——磁盘上删掉的条目绝不在内存滞留。在 Chokidar 打开目标之前，提供方会对层级最深的现有祖先路径执行 realpath 解析，再拼回缺失的后缀；文件访问和诊断仍使用配置路径，从而避免 Windows 混用 8.3 别名与 libuv 的长格式事件路径。提供方自己的写入按内容识别，只发布属于该次提交的一个事件。在 Windows 上，运行中的受保护信封可以来自同一当前用户下的另一个提供方进程；运行中出现的明文降级会被拒绝并保留最后可用快照，直到重启执行加锁迁移。运行期文档不可读、无效或无法解密时保留最后可用快照并告警；文件不存在即空存储；启动时发生同类失败则中止激活。

<a id="security-boundary"></a>

## 安全边界

在 Windows 上，DPAPI 保护静态凭据，抵御离线查看以及以其他 Windows 用户身份运行的进程。它**不能**隔离已经以同一用户身份运行的进程：此类进程也能自行调用 DPAPI，而提供方在处理请求时必然会在内存中持有解密后的值。在 POSIX 上，逻辑文档仍是 `0700`/`0600` 之后的明文；这些权限能阻止其他 OS 用户，不能阻止同 UID 进程。

harness 绝不把文档路径交给模型，也绝不把受管凭据载入进程环境——这与普通环境层 `$DSH_HOME/.env` 不同（见 [app-boot 的 Harness home 各层](../../boot/app-boot/README.zh.md#profiles)）。这能减少意外泄露，但不是 agent 隔离边界。若部署必须让每个同用户工具进程都无法取得提供方密钥，仍需使用由代理服务控制的钥匙串或服务，使这些进程无法调用其解密操作。

## 模型体验

经由消费它的 LLM（大语言模型）适配器间接生效：存储的值为适配器向提供方发出的请求授权，所有模型可见内容均由适配器负责。

#### KV Cache 影响

无直接失效；凭据绝不进入请求前缀。

## 已知限制与暂缓事项

- **同一引用的并发写入是后写胜出**——写锁加读-改-写让并发写入者不会丢掉彼此的条目，但两个写入者编辑同一个引用时仍以较后的写入为准；没有修订检查。
- **同用户进程仍受信任**——见[安全边界](#security-boundary)：Windows DPAPI 防止静态明文泄露，但允许同一 Windows 用户解密；POSIX 依赖仅属主可访问的文件权限。
- **环境变化不可见**：快照在启动时冻结，因此启动之后 export 的变量既不会进入解析，也不会进入 `describe`；要更换来自环境的凭据需要重启。
- **原子但不具备崩溃持久性**——继承自 `dsh-atomic-write`；存储在启动时重新读取。
