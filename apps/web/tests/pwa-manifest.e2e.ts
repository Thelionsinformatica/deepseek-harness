import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Leon — The Lions Informática',
    short_name: 'Leon',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.ico',
      sizes: '16x16 32x32 48x48',
      type: 'image/x-icon',
      purpose: 'any',
    }],
  })
})

it('ships the Leon favicon as a Windows icon file', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.ico'))
  expect([...favicon.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  expect(favicon.byteLength).toBeGreaterThan(4)
})
