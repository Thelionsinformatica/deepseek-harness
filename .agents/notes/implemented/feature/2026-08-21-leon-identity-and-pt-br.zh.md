# Agent Note: Leon identity and Brazilian Portuguese default

Status: implemented

[English](2026-08-21-leon-identity-and-pt-br.md) | 中文

## Problem

The Lions Informática 的 fork 需要一种区别于上游 DeepSeek 呈现的产品标识，也需要一套巴西葡萄牙语界面；当上游功能包先加入英文文案、尚未提供葡萄牙语对侧内容时，界面仍必须可用。若在 React 挂载后替换已渲染文本，无障碍标签、持久化语言选择和动态插件注册会彼此不一致。

## Decision

官方浏览器品牌插件使用原创狮子 SVG、The Lions Informática 字标以及突出显示的 Leon 产品名，占用现有的侧边栏与会话品牌 slot。组件使用共享 Web 主题 token，因此图标和字标在浅色、深色及系统主题下都保持清晰，无需第二套主题服务或全局样式表。

locale 服务在 `zh` 和 `en` 旁提供 `pt`，在语言选择器中显示 `Português (Brasil)`，把 `pt-BR` 写入文档语言，并在既无持久化选择、浏览器也未请求受支持语言时使用巴西葡萄牙语。英文继续作为缺失字典的 fallback，使上游新加入的键仍可阅读。

功能命名空间继续要求完整的中英文字典，并可注册原生 `pt` 条目。当活动 locale 为 `pt` 且功能没有原生条目时，locale 包通过一份巴西葡萄牙语包翻译解析后的英文模板。原生葡萄牙语始终优先，占位符继续属于模板的一部分，尚未翻译的上游新增内容保留为可见英文，而不会退化成键名。

## Alternatives considered

**重命名所有 `@deepseek-ai/dsh-*` 包。** 否决，因为包标识符是内部依赖地址，而不是渲染后的产品标识；改动数百个 manifest 和导入会增加与上游的合并冲突，却不能改善 Leon 界面。

**立即要求每个功能包提供葡萄牙语字典。** 否决，因为语言标识符会让上游每次新增文案都变成跨仓库编译失败。可选的原生字典加集中语言包，使高价值功能能够拥有精确文案，同时在同步上游期间保留可读 fallback。

**翻译已挂载的 DOM。** 否决，因为渲染后替换无法可靠更新无障碍名称、注册时捕获的命令文案或 locale 服务快照，并且会在每次渲染时与 React 冲突。

## Testing

locale 测试固定 `pt` 选择器条目、巴西葡萄牙语暂定默认值、`pt-BR` 文档语言、显式 Host 持久化、英文字典 fallback、集中翻译包和插值行为。品牌测试固定可访问的 Leon 标签、字标文本、请求的图标尺寸、构建 profile 条件、声明顺序、HMR 折叠和资源释放。

## Consequences

Leon 以巴西葡萄牙语启动，并通过上游应用已经拥有的插件组合点承载 The Lions Informática 标识。同步上游时保留稳定的包地址和可读的英文安全路径。代价是需要维护尚未迁移到原生字典的功能文案集中葡萄牙语表；locale 服务之外的内联字符串仍是独立的迁移任务。
