import { describe, expect, it } from 'vitest'
import { joinMiroFishUrl, MiroFishError, readMiroFishEnvelope } from '../src/client.ts'

describe('MiroFish HTTP client helpers', () => {
  it('joins a configured base URL without duplicate slashes', () => {
    expect(joinMiroFishUrl('http://127.0.0.1:5001/', '/health')).toBe('http://127.0.0.1:5001/health')
  })

  it('rejects an empty base URL and a relative API path', () => {
    expect(() => joinMiroFishUrl('  ', '/health')).toThrow('baseUrl')
    expect(() => joinMiroFishUrl('http://localhost:5001', 'health')).toThrow('API path')
  })

  it('accepts successful MiroFish envelopes', async () => {
    const data = await readMiroFishEnvelope(new Response(JSON.stringify({ success: true, data: { id: 'proj_1' } }), { status: 200 }))
    expect(data).toEqual({ id: 'proj_1' })
  })

  it('turns HTTP and application errors into MiroFishError', async () => {
    await expect(readMiroFishEnvelope(new Response(JSON.stringify({ success: false, error: 'offline' }), { status: 503 })))
      .rejects.toMatchObject({ name: 'MiroFishError', statusCode: 503, message: 'MiroFish request failed: offline' })
    await expect(readMiroFishEnvelope(new Response(JSON.stringify({ success: false, error: 'bad request' }), { status: 400 })))
      .rejects.toBeInstanceOf(MiroFishError)
  })
})
