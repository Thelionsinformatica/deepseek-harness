import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  transcribeLocally, type LocalVoiceTranscriptionConfig, type VoiceProcessLauncher,
} from '../src/voice-transcription.ts'

const roots: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): LocalVoiceTranscriptionConfig {
  const root = mkdtempSync(join(tmpdir(), 'leon-voice-worker-'))
  roots.push(root)
  const modelPath = join(root, 'model')
  mkdirSync(modelPath)
  const scriptPath = join(root, 'worker.mjs')
  writeFileSync(scriptPath, [
    'let bytes = 0',
    'for await (const chunk of process.stdin) bytes += chunk.length',
    "process.stdout.write(JSON.stringify({ text: bytes > 0 ? 'fala reconhecida' : '' }))",
  ].join('\n'))
  return {
    pythonPath: process.execPath,
    modelPath,
    scriptPath,
    maxBytes: 1024,
    timeoutMs: 5_000,
  }
}

describe('local voice transcription worker', () => {
  it('hides the worker, scrubs credentials, and returns its transcript', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'must-not-reach-worker')
    let options: SpawnOptionsWithoutStdio | undefined
    const launch: VoiceProcessLauncher = (command, args, supplied) => {
      options = supplied
      return spawn(command, args, supplied)
    }

    await expect(transcribeLocally(fixture(), Buffer.from('encoded audio'), launch))
      .resolves.toBe('fala reconhecida')
    expect(options?.windowsHide).toBe(true)
    expect(options?.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(options?.env).not.toHaveProperty('GOOGLE_API_KEY')
    expect(options?.env?.PYTHONUTF8).toBe('1')
  })

  it('fails before spawning when the offline runtime is absent', async () => {
    const config = fixture()
    config.pythonPath = join(config.modelPath, 'missing-python')
    const launch = vi.fn() as unknown as VoiceProcessLauncher

    await expect(transcribeLocally(config, Buffer.from('voice'), launch)).rejects.toMatchObject({
      status: 503,
      code: 'TRANSCRIBER_UNAVAILABLE',
    })
    expect(launch).not.toHaveBeenCalled()
  })
})
