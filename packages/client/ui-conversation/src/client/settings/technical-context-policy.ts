/** Durable presentation preference for internal prompt-assembly events. */

import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_SHOW_TECHNICAL_CONTEXT, SHOW_TECHNICAL_CONTEXT_FIELD,
  type ConversationSettings,
} from '../../submission-settings.ts'

/** Keeps technical context in the session log while controlling only its chat visibility. */
export class TechnicalContextPolicy {
  /** Reactive source shared by ChatView and the General Settings row. */
  readonly visible: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_SHOW_TECHNICAL_CONTEXT)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Publish immediately, then persist the user's explicit choice.
   *
   * @param visible Whether technical context rows should be visible in chat.
   */
  setVisible(visible: boolean): void {
    if (this.visible.getSnapshot() === visible) return
    this.visible.set(visible)
    void this.host?.set(SHOW_TECHNICAL_CONTEXT_FIELD, visible)
  }

  /** Adopt a validated Host setting without writing it back. */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.visible.getSnapshot() === section.showTechnicalContext) return
    this.visible.set(section.showTechnicalContext)
  }
}
