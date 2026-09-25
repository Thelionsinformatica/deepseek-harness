import type {
  AssistantBlock, AssistantMessageNode, ChatConversationViewNode, CommandNode,
  CompactionSummaryNode, ModelRetryNode, RunningToolCall, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Merge-extensible payload registry keyed by final Chat renderer kind. */
export interface ChatNodeDataMap {}

/** Renderer kinds contributed by the currently installed Chat business modules. */
export type ChatNodeKind = Extract<keyof ChatNodeDataMap, string>

/** Final Chat Node narrowed to one registered renderer kind and payload. */
export type ChatNode<Kind extends ChatNodeKind = ChatNodeKind> = {
  [RegisteredKind in Kind]: ChatConversationViewNode & {
    readonly kind: RegisteredKind
    readonly data: ChatNodeDataMap[RegisteredKind]
  }
}[Kind]

/** Final Assistant row payload shared by streaming and settled states. */
export interface AssistantChatData {
  readonly status: 'running' | 'settled' | 'interrupted'
  readonly turn: number
  readonly step: number
  readonly blocks: readonly AssistantBlock[]
  readonly time: number
  readonly usage?: unknown
  readonly finalNode?: AssistantMessageNode
}

/** Settled or interrupted Assistant payload with its durable presentation node. */
export type FinalAssistantChatData = AssistantChatData & {
  readonly finalNode: AssistantMessageNode
}

/** Root Tool row payload; the root lifecycle owns all recursive subcalls. */
export interface ToolChatData {
  readonly root: ToolCallBlock
}

/** One manual command and its correlated compaction transaction. */
export interface ManualCompactionChatData {
  readonly command: CommandNode
  readonly compaction: CompactionSummaryNode | null
}

/** One durable retry chain rendered as a single row. */
export interface RetryChatData {
  readonly attempts: readonly ModelRetryNode[]
  readonly current: ModelRetryNode
}

/** Turn-local footer row that owns actions and optional feature contributions. */
export interface TurnTailChatData {
  readonly turn: number
  readonly seq: number
  readonly time: number
  /** Last finalized content-bearing Assistant in this Turn. */
  readonly closing: FinalAssistantChatData | null
  /** Whether non-rendered later evidence makes the closing seq non-tail. */
  readonly branchUnavailable: boolean
  readonly ttftMs?: number
  readonly tokensPerSecond?: number
}

/** UI states for a task with an explicit acceptance decision. */
export type ValidationPhase = 'checking' | 'correcting' | 'validated' | 'unvalidated'

/** Latest observed acceptance decision and terminal outcome for one turn. */
export interface TaskValidationState {
  readonly turn: number
  readonly seq: number
  readonly attempt: number
  readonly status: 'passed' | 'retry' | 'failed'
  readonly ended?: 'completed' | 'other'
}

/**
 * Resolve a conservative label, never treating an intermediate pass as final success.
 * @param state - Latest decision and optional turn ending.
 * @returns Display phase limited to the supplied acceptance criterion.
 */
export function taskValidationPhase(state: TaskValidationState): ValidationPhase {
  if (state.ended !== undefined) return state.ended === 'completed' && state.status === 'passed' ? 'validated' : 'unvalidated'
  return state.status === 'retry' ? 'correcting' : state.status === 'failed' ? 'unvalidated' : 'checking'
}

/**
 * Test whether a Tool root has settled.
 * @param block - Tool root lifecycle value.
 * @returns whether the root carries its final result.
 */
export function isSettledTool(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

/**
 * Test whether a Tool root is still running.
 * @param block - Tool root lifecycle value.
 * @returns whether the root lacks a final result.
 */
export function isRunningTool(block: ToolCallBlock): block is RunningToolCall {
  return !isSettledTool(block)
}
