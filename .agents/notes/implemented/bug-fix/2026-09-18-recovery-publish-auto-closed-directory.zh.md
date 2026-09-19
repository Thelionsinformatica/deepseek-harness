# Agent Note: 恢复发布重复关闭已自动关闭的暂存目录

Status: implemented

[English](2026-09-18-recovery-publish-auto-closed-directory.md) | 中文

## 问题

`publishStaging` 用 `for await` 遍历 `await opendir(staging)`，再在 `finally` 中调用 `directory.close()`。Node 的异步迭代器在遍历结束时已自动关闭 `Dir`，显式关闭抛出 `ERR_DIR_CLOSED`，导致每次已通过校验的恢复都失败在发布步骤，暂存内容被遗留。

## 决定

枚举依赖异步迭代器自身的关闭：收集条目名、排序后按序重命名进已声明的目标目录，不再显式 `close()`。`recovery-format.ts` 中其他 `opendir` 调用点本就遵循此模式。

## 验证

`apps/cli/tests/recovery.spec.ts` 全部 10 项测试通过，包括要求恰好一个胜者的并发恢复和过期锁路径。这些是不使用密钥的测试，不证明某个具体用户备份的恢复成功。

## 考虑过的替代方案

手动 `read()` 迭代只增加簿记而无收益。吞掉关闭错误会掩盖真实的发布失败，使暂存数据失去核算。

## 后果

加密恢复的发布端到端可用。独占 `mkdir` 声明、暂存前字节级校验、协作式恢复锁以及不替换不合并的保证均不变。
