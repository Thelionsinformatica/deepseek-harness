# Agent Note：Leon 加密离线恢复

状态：已实现

[English](2026-08-27-encrypted-offline-leon-recovery.md) | 中文

## 问题

Leon 需要一个可移植恢复边界，以保存持久会话、记忆、人格、附件和 profile 配置。盲目复制整台机器既不可移植也不安全：提供方凭据和粘贴到会话中的秘密可能与状态并存；workspace 与模型权重可独立恢复；生成的依赖树包含链接；多个 backend 写入期间复制文件还可能产生从未真实存在过的混合状态。

## 决策

启动器提供不启动 profile 的 `dsh backup` 与 `dsh restore` 模式。备份从已解析 Harness home 下选择明确的权威 allowlist，哈希每个普通且仅有单个链接的源文件，并创建一个流式 `LEONBK1` 容器。其加密 manifest 记录 Leon／runtime 版本、workspace 引用、尽力从 loopback 获取的 Ollama 清单、排除项，以及每个路径／大小／SHA-256／所有者 mode。系统会排除受管凭据存储及命名的环境、凭据、密钥和证书文件，还会排除匿名遥测身份、派生缓存、依赖、workspace 内容、代码仓库、可执行文件和模型权重。这项文件名策略并不执行内容脱敏：会话及其他用户编写的文件可能包含用户粘贴的秘密，因此整个恢复包的加密就是保密边界。

恢复包使用 scrypt 与 AES-256-GCM。manifest 和每个文件都有独立认证记录与唯一 nonce；路径、大小、哈希和 mode 作为附加数据接受认证。系统不使用压缩，也没有通用归档解压器。默认密钥来源是不回显的 TTY 提示；可信安装程序自动化可以使用有长度上限的重定向 stdin；argv 和环境变量都不是密钥通道。

真实备份要求操作者停止所有 Leon 进程并提供 `--confirm-stopped`；默认 Web 端口存在 listener 时也会阻止执行。写入器在加密时再次读取每个已规划文件、验证哈希与最终 allowlist 路径集合、同步同级私有 staging 文件，并通过不会覆盖目标的 hard link 发布；随后重新打开并认证恢复包。不支持 hard link 的文件系统会安全失败；发布后的清理或目录同步失败会成为 warning，而不会错误声称没有创建恢复包。dry run 会执行清点和哈希，但不会询问密码或写入文件。

除非提供 `--apply`，恢复仅执行验证。系统会认证完整恢复包，并拒绝不安全／不在 allowlist 的路径、Windows alias 和 ADS、重复项、大小写／Unicode 碰撞、文件目录冲突、不支持的版本、声明包含受管凭据存储的 manifest、大小／数量超限、截断、尾随数据或完整性失败。apply 还要求已停止进程的声明与完全一致的 Leon 版本。系统先认证整个 archive，再创建 staging；随后获取排他的同级 restore lock，通过可丢弃的 partial 物化每个文件，并且只向检查时不存在的目标发布。陈旧 lock 会令操作安全失败。版本 1 永不合并或故意替换现有 home，也不会在验证期间加载已恢复的插件或指令。该协作式 lock 不声称能在所有支持的操作系统上抵御恶意且不配合的进程竞速修改文件系统。

## 考虑过的替代方案

**将完整 Harness home 打包为 ZIP。** 已拒绝，因为通用解压器会引入 traversal、重复 entry、symlink 和压缩炸弹语义，而完整目录树还会捕获恢复约定明确排除的凭据、依赖 junction、缓存与机器身份。

**复制活动 home 并接受尽力而为的一致性。** 第一版已拒绝，因为会话、JSON storage、设置、附件与 headless 进程之间不存在全局快照屏障。双重哈希可以检测很多变化，但不能证明独立 backend 之间形成了一笔事务。

**替换当前 home 并自动 rollback。** 暂缓，因为破坏性替换需要持久跨进程锁、带 journal 的交换状态、Windows ACL 处理和启动后验证。首先只恢复到缺失目标，可为安装程序提供非破坏性原语。

## 后果

Leon 现在拥有确定性的加密状态包；系统可以在不产生变更的情况下验证它，并以一个完整 staging 目录恢复到新的 home。受管凭据必须重新登记；profile 依赖与模型权重必须重新安装；workspace、源码仓库、外部 `.leon` 集成数据库和临时 spill artifact 需要单独的备份产品。`--confirm-stopped` 仍然只是操作者声明，而不是完整进程锁；Node 权限位也无法建立私有 Windows DACL。未来 Windows 安装程序必须补充生命周期锁、ACL 应用、精确版本安装、项目备份协调、带 journal 的替换／rollback 和恢复后验收，之后才可以替换活动安装。
