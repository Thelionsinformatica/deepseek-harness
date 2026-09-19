# Agent Note: Leon composer 中的产品操作菜单

Status: implemented

[English](2026-08-23-product-action-composer-menu.md) | 中文

## Problem

composer 的前置加号按钮此前直接打开底层命令目录。虽然命令路径是真实的，但该控件没有向用户说明可用的工作型操作，文件、Workspace、目标、规划和已安装技能只能通过彼此分散的技术 trigger 发现。

## Decision

加号按钮现在会在 `InputBar` 内打开紧凑的产品操作菜单。每一行都委托给现有 owner：文件和文件夹打开原生多图片选择器，并把选择结果送入现有附件 intake；从项目引用打开 `reference` input-trigger source；在项目中工作读取 Workspace 投影，并使用 Workspace runtime 连接项目或注册经原生选择器选中的目录；目标在保留草稿文本的同时填入已认领的 `/goal` 命令；规划模式提交 `/plan` 或 `/plan off`；插件和技能打开 `skill` source；高级命令打开 `command` source。

该菜单是对现有能力的导航，而不是第二套命令系统。持久图片服务继续负责验证和保留本机选择，现有 input-trigger `MenuView` 继续负责项目引用、技能和命令的发现与选择；Workspace runtime 继续负责项目状态；会话命令继续负责目标与规划行为。产品菜单仅渲染具备所需 owner 的操作，也不会宣传不可用的外部 connector 或尚未支持的通用文档附件。

## Alternatives considered

**保留加号按钮作为直接命令启动器。** 否决，因为它虽然保留技术入口，却没有提供 Leon 产品所需的易用 Work 风格入口。

**复制其他产品展示的所有 connector。** 否决，因为 Leon 不应承诺尚未安装和连接的集成。已安装技能通过 Leon 的权威 skill source 展示，未来 connector 必须随真实 capability owner 一同引入。

**在 composer 内另行实现文件、技能和项目浏览器。** 否决，因为重复的发现与持久化路径会与现有 input-trigger 和 Workspace 领域发生漂移。

## Testing

InputBar 组件测试覆盖菜单可见性、原生本机选择器启动与所选图片 intake、项目引用与技能路由、高级命令选择、目标草稿保留、规划模式进入与退出、Workspace 列表、项目切换和本地目录注册。注入测试继续覆盖无会话行为和 Workspace 草稿迁移。无密钥的组装 Web 场景连接真实 Workspace，把产品操作菜单的稳定 accessibility tree 与提交的 golden 比较，确认选择器接受多文件，把真实 PNG 加入待发送图片栏后再移除；完整构建、4,026 项 GUI 测试、lint 和本地构建界面验证共同确认发布组合。

## Consequences

Leon 现在通过一个熟悉的控件暴露最常用的工作操作，同时不隐藏现有斜杠命令工作流。该菜单在维持每项能力单一事实来源的同时提升可发现性和产品清晰度。外部服务插件仍是独立路线项，并且只会在真正安装和连接后出现。
