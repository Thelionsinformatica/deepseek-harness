/** The composer control reaches the command Remote, so it must declare it. */
import { describe, expect, it } from 'vitest'
import { inject } from '@deepseek-ai/dsh-client-ui-web-access/client'

describe('ui-web-access', () => {
  it('declares the command Remote it executes /web through', () => {
    expect(inject).toEqual(expect.arrayContaining(['slots', 'remote', 'remote.commands', 'locale']))
  })
})
