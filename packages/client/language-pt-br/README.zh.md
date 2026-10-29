---
description: "浏览器客户端的巴西葡萄牙语语言包，供部署葡萄牙语界面或更新其翻译的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-language-pt-br

[English](README.md) | 中文

## 概述

为浏览器界面添加巴西葡萄牙语（`pt-BR`）的客户端语言包。它以英语为回退注册该语言，并为每个带英文文本的客户端命名空间注册一份 pt-BR 词典，因此首选语言为葡萄牙语的浏览器会以 pt-BR 打开，语言设置行也会明确提供该选项。语言包尚未翻译的键显示其英文文本，绝不显示原始键名。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载宿主行；客户端加载器会在启动时、界面渲染之前激活浏览器端：

```yaml
- id: language-pt-br
  name: '@deepseek-ai/dsh-client-language-pt-br'
```

`dsh-leon` 组合包会挂载它。上游升级后，运行 `pnpm run leon:locale-coverage`，列出语言包尚未翻译的英文键、上游已删除的键以及占位符不一致；加上 `--strict` 时，任何一项都会使命令失败。

<a id="understand-the-implementation"></a>
## 理解实现

[`src/client/index.ts`](src/client/index.ts) 以 id `pt-BR`、标签 `Português (Brasil)` 和回退 `en` 调用 `ctx.locale.addLanguage`，然后通过单语言形式 `ctx.locale.register(namespace, 'pt-BR', dictionary)` 注册 [`src/client/dictionaries.ts`](src/client/dictionaries.ts) 中的每份词典。每次注册都是上下文副作用，因此卸载插件会移除该语言及其词典。译文保留英文原文中的 `{name}` 占位符；`/goal` 等命令令牌不翻译，因为用户需要输入它们。

<a id="model-experience"></a>
## 模型体验

间接地，通过浏览器界面：本语言包只改变界面文本，从不进入模型请求。

#### KV Cache 影响

无；提示文本、工具 schema 和请求选项都不依赖界面语言。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **动态字符串保持英文** — 客户端在运行时由模板或拼接生成的约二十条文本不在静态词典中，覆盖脚本无法看到它们。
- **引导插图** — 引导插图只有英文和中文版本；pt-BR 显示英文插图。
- **包与插件元数据** — 包的 `locale/*.json` 中声明的标题和描述不属于本语言包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，不具权威性。词典译自 `scripts/leon-locale-coverage.ts` 提取的英文词典；翻译修改应与它所回应的覆盖变化放在同一次提交中。

</details>
