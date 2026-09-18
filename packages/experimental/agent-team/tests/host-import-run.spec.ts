import { expect, it } from 'vitest'
import { HandoffLedger } from '../src/host-import-run.ts'

it('does not repeat host feedback when the relevant state has not changed', () => {
  const ledger = new HandoffLedger()
  expect(ledger.admit('research-id', 'digest-a/task-open')).toBe(true)
  expect(ledger.admit('research-id', 'digest-a/task-open')).toBe(false)
  expect(ledger.admit('checker-id', 'digest-a/task-open')).toBe(true)
  expect(ledger.admit('research-id', 'digest-b/task-open')).toBe(true)
  expect(ledger.admit('research-id', 'digest-a/task-open')).toBe(false)
})
