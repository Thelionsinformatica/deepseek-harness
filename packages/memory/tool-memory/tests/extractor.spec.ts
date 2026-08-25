import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractMemoryCandidate } from '../src/extractor.ts'
import { memoryCandidateRecord } from '../src/spec.ts'

const userMessage = (text: string) => createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
})

describe('memory candidate extractor', () => {
  it('preserves version 2 shadow rows and defaults new rows to version 3', () => {
    const record = {
      id: 'candidate-id',
      workspaceId: 'workspace-id',
      sessionId: 'session-id',
      source: 'tool-memory' as const,
      operation: 'memory_recall' as const,
      queryLength: 12,
      confidence: 1,
      total: 1,
      omittedSensitive: 0,
      inserted: 1,
      topScore: 1,
      policyVersion: 1,
      policyDecision: 'shadow' as const,
      policyReason: 'moderate-confidence' as const,
      reviewed: false,
      createdAt: '2026-08-25T00:00:00.000Z',
    }
    expect(memoryCandidateRecord.parse({ ...record, schemaVersion: 2 }).schemaVersion).toBe(2)
    expect(memoryCandidateRecord.parse(record).schemaVersion).toBe(3)
  })

  it('extracts an explicit PT-BR preference without retaining the command prefix', () => {
    expect(extractMemoryCandidate([
      userMessage('Leon, lembre que eu prefiro respostas diretas em português brasileiro.'),
    ])).toEqual({
      content: 'Eu prefiro respostas diretas em português brasileiro.',
      category: 'preference',
      confidence: 0.95,
      importance: 0.7,
      sensitivity: 'none',
      scopeCandidate: 'workspace',
    })
  })

  it('extracts a confirmed project decision but ignores an ordinary question', () => {
    expect(extractMemoryCandidate([
      userMessage('A decisão do projeto é usar Ollama primeiro e Gemini como fallback.'),
    ])).toMatchObject({
      category: 'decision',
      confidence: 0.82,
      scopeCandidate: 'workspace',
    })
    expect(extractMemoryCandidate([userMessage('Qual modelo devemos usar hoje?')])).toBeUndefined()
  })

  it('marks credential-like candidates as blocked and drops their content', () => {
    const candidate = extractMemoryCandidate([
      userMessage('Lembre que minha API key é sk-proj-1234567890abcdefghijklmnop.'),
    ])
    expect(candidate).toMatchObject({ sensitivity: 'blocked', scopeCandidate: 'workspace' })
    expect(candidate).not.toHaveProperty('content')
  })
})
