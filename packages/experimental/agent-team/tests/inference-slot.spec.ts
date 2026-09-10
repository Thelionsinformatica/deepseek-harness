import { expect, it } from 'vitest'
import { InferenceSlot } from '../src/inference-slot.ts'

it('serializes generations and releases the next waiter exactly once', async () => {
  const slot = new InferenceSlot()
  const signal = new AbortController().signal
  const first = await slot.acquire(signal)
  let entered = false
  const second = slot.acquire(signal).then((release) => { entered = true; return release })
  await Promise.resolve()
  expect(entered).toBe(false)
  first()
  first()
  const release = await second
  expect(entered).toBe(true)
  release()
  slot.close()
})

it('removes aborted queue entries without starving the following generation', async () => {
  const slot = new InferenceSlot()
  const signal = new AbortController().signal
  const first = await slot.acquire(signal)
  const controller = new AbortController()
  const second = slot.acquire(controller.signal)
  const rejected = expect(second).rejects.toThrow('STOP')
  controller.abort(new Error('STOP'))
  await rejected
  const third = slot.acquire(signal)
  first()
  ;(await third)()
  slot.close()
})

it('disposal rejects queued and future generations', async () => {
  const slot = new InferenceSlot()
  const signal = new AbortController().signal
  const release = await slot.acquire(signal)
  const pending = slot.acquire(signal)
  const rejected = expect(pending).rejects.toThrow('closed')
  slot.close()
  await rejected
  await expect(slot.acquire(signal)).rejects.toThrow('closed')
  release()
})
