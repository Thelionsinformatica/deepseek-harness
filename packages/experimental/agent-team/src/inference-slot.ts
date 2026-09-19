/** Abortable FIFO admission for one model generation; tool execution never owns the slot. */
export class InferenceSlot {
  private active = false
  private readonly queue: Array<{ grant: () => void; reject: (reason: unknown) => void }> = []
  private closed = false

  /**
   * Reserve a generation slot; cancellation removes a pending waiter.
   * @param signal - bounded caller cancellation, including queue timeout.
   * @returns idempotent release; caller must release after stream settlement.
   */
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.closed) return Promise.reject(new Error('Inference slot closed'))
    return new Promise((resolve, reject) => {
      const remove = () => {
        const index = this.queue.indexOf(waiter)
        if (index >= 0) this.queue.splice(index, 1)
        signal.removeEventListener('abort', abort)
      }
      const abort = () => { remove(); reject(signal.reason instanceof Error ? signal.reason : new Error('Inference cancelled')) }
      const waiter = {
        grant: () => {
          remove()
          this.active = true
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.active = false
            this.queue.shift()?.grant()
          })
        },
        reject: (reason: unknown) => { remove(); reject(reason instanceof Error ? reason : new Error('Inference cancelled')) },
      }
      signal.addEventListener('abort', abort, { once: true })
      if (this.active) this.queue.push(waiter)
      else waiter.grant()
    })
  }

  /** Reject queued calls; the runtime cancels and awaits active model turns separately. */
  close(): void {
    this.closed = true
    for (const waiter of [...this.queue]) waiter.reject(new Error('Inference slot closed'))
  }
}
