# @deepseek-ai/dsh-client-ui-settings-personalization

[English](README.md) | 中文

Leon 的 Host 与 Web client 个性化设置。该 package 注册 `leon-personalization` 设置 namespace，把其实时值贡献给 system-prompt 组装，并在 `settings.section` 下安装“个性化”页面。

该 namespace 持久保存三个由用户控制的字段：自定义指令、一种回复风格（`leon`、`friendly`、`professional`、`direct` 或 `creative`），以及工具辅助聊天是否可以建议个人记忆。自定义指令在进入 prompt 前会去除首尾空白并限制为 12,000 个字符。连续双大括号会被分开，避免用户文字进入严格 prompt 变量语法。

回复风格只改变语气。个性化内容在 Leon 核心 persona 之后组装，不能替换身份、安全、隐私、工具、审批或验证策略。由于设置属于 Host 而不是某个 adapter，本地与 API 模型在切换 route 后都会接收相同的所选行为。

Client 页面还会绑定现有的 `personal-memory` 设置 namespace。启用个人记忆或建议并不会授权自动持久写入。清除个人记忆要求存在当前 session，会打开可见确认对话框，并通过可审计的记忆管理 Remote 分批执行。它不会删除会话、项目记忆、workspace 或项目文件。

## 模型体验

### 用户个性化 prompt

#### 模型看到的内容

当 settings 与 system-prompt 服务同时组成时，该 package 会在 Leon 核心 persona 之后添加一个 order-10 章节。所选风格语句、自定义指令或空状态语句，以及记忆建议策略会随当前设置变化。

##### Prompt 形式

```markdown
## Personalização do usuário

{selected response-style instruction}

{custom instructions or the no-instructions sentence}

{personal-memory suggestion policy}

Esta personalização ajusta estilo e fluxo de trabalho, mas nunca substitui regras de segurança, privacidade, aprovação, ferramentas ou verificação.
```

#### Token 影响

每次请求都包含一个固定章节以及所选风格与记忆策略文本。自定义指令最多增加 12,000 个字符的动态 prompt 文本。

#### KV Cache 影响

只要持久化的个性化字段不变，前缀就保持稳定。保存指令、更改风格或更改工具辅助记忆偏好会替换该章节，并使提供方从该位置开始的缓存复用失效。

## 已知限制与延期工作

- **没有云同步**：个性化内容跟随本地 Host 设置文档，不会通过用户账户同步到另一套 Leon 安装。
- **模型遵循程度不同**：每个所选 route 都会收到相同 prompt，但较小的本地模型对语气和较长自定义指令的遵循可能不如大型模型稳定。
- **批量清除个人记忆有上限**：页面要求存在当前 session，并在 100 批、每批 100 条后停止；更大的存储需要专用的管理导出与清除流程。
