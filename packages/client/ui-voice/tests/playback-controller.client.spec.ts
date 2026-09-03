import { describe, expect, it, vi } from 'vitest'
import type {
  VoicePlaybackDriver, VoicePlaybackReceipt,
} from '../src/client/browser-playback.ts'
import { VoicePlaybackController } from '../src/client/playback-controller.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('VoicePlaybackController', () => {
  it('publishes speaking and returns to idle after local playback', async () => {
    const driver: VoicePlaybackDriver = {
      speak: vi.fn(async () => ({ voiceName: 'Microsoft Daniel' })),
    }
    const controller = new VoicePlaybackController(driver)

    await controller.speak('Bom dia')

    expect(driver.speak).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toEqual({
      status: 'idle', text: null, voiceName: 'Microsoft Daniel', error: null,
    })
  })

  it('interrupts audio without exposing any session cancellation verb', async () => {
    const result = deferred<VoicePlaybackReceipt>()
    let signal!: AbortSignal
    const controller = new VoicePlaybackController({
      speak: vi.fn((_text: string, activeSignal: AbortSignal): Promise<VoicePlaybackReceipt> => {
        signal = activeSignal
        return result.promise
      }),
    })

    const speaking = controller.speak('Resposta longa')
    expect(controller.getSnapshot().status).toBe('speaking')
    controller.interrupt()

    expect(signal.aborted).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'interrupted', text: 'Resposta longa', error: null,
    })
    result.resolve({ voiceName: 'Microsoft Daniel' })
    await speaking
    expect(controller.getSnapshot().status).toBe('interrupted')
  })

  it('ignores a late result from replaced speech', async () => {
    const first = deferred<VoicePlaybackReceipt>()
    const second = deferred<VoicePlaybackReceipt>()
    const speak = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const controller = new VoicePlaybackController({ speak })

    const old = controller.speak('antiga')
    const current = controller.speak('nova')
    first.resolve({ voiceName: 'old' })
    await old
    expect(controller.getSnapshot()).toMatchObject({ status: 'speaking', text: 'nova' })
    second.resolve({ voiceName: 'current' })
    await current
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', voiceName: 'current' })
  })

  it('aborts the provider and settles silently on disposal', async () => {
    const result = deferred<VoicePlaybackReceipt>()
    let signal!: AbortSignal
    const controller = new VoicePlaybackController({
      speak: (_text, activeSignal) => {
        signal = activeSignal
        return result.promise
      },
    })
    const speaking = controller.speak('encerrar')

    controller.dispose()
    expect(signal.aborted).toBe(true)
    result.resolve({ voiceName: 'late' })
    await speaking
  })

  it('clears an old interrupted or error state when the owning session changes', async () => {
    const controller = new VoicePlaybackController({
      speak: vi.fn(async () => { throw new Error('speaker failed') }),
    })
    await controller.speak('falha')
    expect(controller.getSnapshot().status).toBe('error')

    controller.stop()

    expect(controller.getSnapshot()).toEqual({
      status: 'idle', text: null, voiceName: null, error: null,
    })
  })
})
