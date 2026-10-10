/**
 * The Leon bundle's substance is its patch files and shipped skills: the
 * manifest must name parseable patches, every preset row must satisfy its
 * plugin's own Config schema, and the knowledge helper copies must not drift.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface Row {
  id?: string
  name?: string
  config?: unknown
  disabled?: unknown
  group?: boolean
}

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string[] } }
}

function patchRows(file: string): { inserted: Row[]; patched: Row[] } {
  const parsed = yaml.load(readFileSync(resolve(root, file), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError(`${file} must parse to a patch list`)
  const entries = parsed as (Row & { insert?: Row[] })[]
  return {
    inserted: entries.flatMap(entry => entry.insert ?? []),
    patched: entries.filter(entry => entry.insert === undefined),
  }
}

/** Whether a parsed config value contains a deferred `!!js` expression. */
function hasExpression(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  if ('__jsExpr' in value) return true
  return Object.values(value).some(hasExpression)
}

const presetRow = patchRows('presets/leon.patch.yml').inserted.find(row => row.id === 'preset-leon')
const presetPlugins = (presetRow?.config as { plugins?: Row[] } | undefined)?.plugins ?? []
const flatPlugins = presetPlugins.flatMap(row => row.group === true ? (row.config as Row[]) : [row])

describe('dsh-leon bundle', () => {
  it('declares the host patch and the leon preset patch, and makes leon the default', () => {
    expect(manifest.dsh?.bundle?.patch).toEqual(['./cordis.patch.yml', './presets/leon.patch.yml'])
    const host = patchRows('cordis.patch.yml')
    expect(host.patched.find(row => row.id === 'agent-preset-registry')?.config).toEqual({ default: 'leon' })
    expect(host.inserted.map(row => row.id)).toEqual([
      'memory', 'memory-local', 'personal-memory', 'personal-memory-local',
      'memory-candidate-review', 'procedure-learning', 'failure-recovery-policy',
      'language-pt-br', 'web-egress-approval',
    ])
    expect(host.inserted.find(row => row.id === 'memory-candidate-review')?.config).toMatchObject({ automaticWrite: false })
  })

  it('ships local semantic memory retrieval as an explicit opt-in', () => {
    const memoryLocal = patchRows('cordis.patch.yml').inserted.find(row => row.id === 'memory-local')
    expect(memoryLocal?.config).toMatchObject({ semanticSearch: { enabled: false } })
  })

  it('declares every plugin package its patches mount', () => {
    const rows = [...patchRows('cordis.patch.yml').inserted, ...flatPlugins]
    for (const row of rows) {
      if (row.name === undefined || row.name.startsWith('cordis:')) continue
      const pkg = row.name.split('/').slice(0, 2).join('/')
      expect(manifest.dependencies, row.name).toHaveProperty(pkg)
    }
  })

  it('composes web tools only behind the host egress approval guard, and no MCP yet', () => {
    expect(flatPlugins.map(row => row.name)).toContain('@deepseek-ai/dsh-tool-web')
    const guard = patchRows('cordis.patch.yml').inserted.find(row => row.id === 'web-egress-approval')
    expect(guard?.disabled).toBeUndefined()
    expect(guard?.config).toMatchObject({ tools: ['web_search', 'web_fetch'] })
    expect(flatPlugins.map(row => row.name)).not.toContain('@deepseek-ai/dsh-mcp-client')
  })

  it('satisfies each plugin Config schema for every literal preset row', async () => {
    const checked: string[] = []
    for (const row of flatPlugins) {
      if (row.name === undefined || row.config === undefined || hasExpression(row.config)) continue
      const [pkg, sub] = row.name.split('/').slice(1).length === 2
        ? [row.name.split('/').slice(0, 2).join('/'), row.name.split('/')[2]]
        : [row.name, undefined]
      const module = await import(sub === undefined ? pkg : `${pkg}/${sub}`) as {
        Config?: (value: unknown) => unknown
        default?: { Config?: (value: unknown) => unknown }
      }
      const schema = module.Config ?? module.default?.Config
      if (typeof schema !== 'function') continue
      expect(() => schema(structuredClone(row.config)), row.id).not.toThrow()
      checked.push(row.id ?? row.name)
    }
    expect(checked).toEqual(expect.arrayContaining(['persona', 'explicit-target-policy', 'tool-memory', 'completion-claim-policy']))
  })

  it('ships skills whose frontmatter names match their directories', () => {
    const skills = readdirSync(resolve(root, 'skills'))
    expect(skills).toEqual(expect.arrayContaining(['leon-knowledge-base', 'leon-project-engineer', 'leon-windows', 'leon-browser']))
    for (const skill of skills) {
      const body = readFileSync(resolve(root, 'skills', skill, 'SKILL.md'), 'utf8')
      expect(body.match(/^name: (.+)$/m)?.[1], skill).toBe(skill)
    }
  })

  it('keeps the skill copy of the knowledge helper identical to the tool package helper', () => {
    const skillHelper = resolve(root, 'skills/leon-knowledge-base/scripts/knowledge.mjs')
    const toolHelper = resolve(root, '../../knowledge/tool-knowledge-base/helper/knowledge.mjs')
    expect(existsSync(skillHelper)).toBe(true)
    expect(readFileSync(skillHelper)).toEqual(readFileSync(toolHelper))
  })
})
