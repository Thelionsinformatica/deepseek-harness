/**
 * Enforce intra-package domain layering inside `packages/client/*\/src/client/`.
 * verify-module-graph covers package-level edges; this gate covers the
 * directory level: domain directories may import `contract/` and never each
 * other, and only the assembly point (`apply.ts` / `index.ts`) may import
 * across domains.
 *
 * Layer model (lower may not import higher):
 *   0  contract/            shared contract API (types + slot declarations)
 *   1  <domain>/ + service  domain implementations (skeleton/, chat/, ...)
 *   2  apply.ts, index.ts   assembly point and re-export shell
 *
 * Run directly:
 *   pnpm exec tsx scripts/verify-client-domain-graph.ts
 */

import { globSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const CLIENT_DIR = join(root, 'packages/client')

/** Directory names treated as the shared contract layer (importable by all). */
const CONTRACT_DIRS = new Set(['contract'])
/** Top-level client files allowed to import across domains (assembly layer). */
const ASSEMBLY_FILES = new Set(['apply.ts', 'index.ts', 'index.tsx'])

export interface Violation { file: string; imported: string; reason: string }

/**
 * Locked budgets for domain edges inherited from the upstream codebase.
 *
 * This is a ratchet, not a general allowlist: a new edge, an extra occurrence,
 * or a removed occurrence all fail the gate. When a legacy edge is refactored,
 * its budget must be reduced in the same change so the debt cannot return.
 */
const LEGACY_EDGE_BUDGETS: Readonly<Record<string, number>> = {
  'runtime/src/client/contract/session.ts -> ../sessions/conversation.ts': 1,
  'runtime/src/client/contract/sessions.ts -> ../agents/scope.ts': 2,
  'runtime/src/client/contract/sessions.ts -> ../sessions/manager.ts': 1,
  'runtime/src/client/contract/sessions.ts -> ../sessions/service.ts': 1,
  'runtime/src/client/contract/workspaces.ts -> ../workspaces/service.ts': 1,
  'runtime/src/client/sessions/service.ts -> ../agents/scope.ts': 2,
  'runtime/src/client/workspaces/manager.ts -> ../sessions/notifier.ts': 1,
  'runtime/src/client/workspaces/workspace.ts -> ../sessions/notifier.ts': 1,
  'ui-conversation/src/client/chat/ContextInjectionRow.tsx -> ../reference/ReferenceIcon.tsx': 1,
  'ui-conversation/src/client/chat/MessageItem.tsx -> ../reference/ReferenceIcon.tsx': 1,
  'ui-conversation/src/client/contract/slots.ts -> ../input/blocks.ts': 1,
  'ui-conversation/src/client/contract/slots.ts -> ../input/contract.ts': 1,
  'ui-conversation/src/client/conversation-nodes/turn-tail.ts -> ../chat/turn-metrics.ts': 1,
  'ui-conversation/src/client/input/hub.ts -> ../queue/store.ts': 1,
  'ui-conversation/src/client/queue/store.ts -> ../input/contract.ts': 1,
  'ui-conversation/src/client/service.ts -> ./input/blocks.ts': 1,
  'ui-conversation/src/client/service.ts -> ./input/contract.ts': 1,
  'ui-conversation/src/client/skeleton/ApprovalPanel.tsx -> ../chat/tool-node-reader.ts': 1,
  'ui-conversation/src/client/skeleton/ContextMeter.tsx -> ../chat/StatsLine.tsx': 1,
  'ui-conversation/src/client/skeleton/DetailsPanel.tsx -> ../chat/tool-node-reader.ts': 1,
  'ui-conversation/src/client/skeleton/InputBar.tsx -> ../input/decorations.ts': 2,
  'ui-conversation/src/client/skeleton/InputBar.tsx -> ../input/contract.ts': 1,
  'ui-conversation/src/client/skeleton/InputBar.tsx -> ../reference/ReferenceIcon.tsx': 1,
  'ui-workspace/src/client/WorkspaceBrowser.tsx -> ./rows/Rows.tsx': 1,
}

/** Stable identity for one cross-domain import edge. */
export function violationKey(violation: Pick<Violation, 'file' | 'imported'>): string {
  return `${violation.file} -> ${violation.imported}`
}

export interface DomainGraphAudit {
  acceptedLegacyOccurrences: number
  regressions: Array<{ actual: number; allowed: number; key: string }>
  staleBudgets: Array<{ actual: number; allowed: number; key: string }>
}

/**
 * Compare observed violations with locked legacy budgets.
 * @param violations - Cross-domain imports found in the current tree.
 * @param budgets - Maximum occurrence count for each inherited edge.
 * @returns Regressions and stale budgets that require an explicit source change.
 */
export function auditDomainViolations(
  violations: readonly Violation[],
  budgets: Readonly<Record<string, number>> = LEGACY_EDGE_BUDGETS,
): DomainGraphAudit {
  const counts = new Map<string, number>()
  for (const violation of violations) {
    const key = violationKey(violation)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const keys = new Set([...Object.keys(budgets), ...counts.keys()])
  const regressions: DomainGraphAudit['regressions'] = []
  const staleBudgets: DomainGraphAudit['staleBudgets'] = []
  let acceptedLegacyOccurrences = 0

  for (const key of [...keys].sort()) {
    const actual = counts.get(key) ?? 0
    const allowed = budgets[key] ?? 0
    if (actual > allowed) regressions.push({ actual, allowed, key })
    if (actual < allowed) staleBudgets.push({ actual, allowed, key })
    acceptedLegacyOccurrences += Math.min(actual, allowed)
  }

  return { acceptedLegacyOccurrences, regressions, staleBudgets }
}

/** Recursively list .ts/.tsx files under dir (relative paths). */
function listSources(dir: string): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: dir })
    .map(rel => rel.split(sep).join('/'))
    .filter(rel => !/\.legacy\./.test(rel.slice(rel.lastIndexOf('/') + 1)))
    .sort()
}

/** First path segment of a client-relative file, or '' for top-level files. */
function domainOf(rel: string): string {
  const ix = rel.indexOf('/')
  return ix === -1 ? '' : rel.slice(0, ix)
}

/**
 * Resolve one relative import to a client-directory-relative path.
 * @param file - Importing file relative to `src/client`.
 * @param specifier - Relative module specifier from that file.
 * @returns Normalized path, preserving leading `..` segments outside `src/client`.
 */
export function resolveClientImport(file: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(file), specifier))
}

function checkPackage(pkgName: string, clientDir: string): Violation[] {
  const violations: Violation[] = []
  const files = listSources(clientDir)
  for (const rel of files) {
    const fromDomain = domainOf(rel)
    const isAssembly = fromDomain === '' && ASSEMBLY_FILES.has(rel)
    if (isAssembly) continue
    const source = readFileSync(join(clientDir, rel), 'utf8')
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec === undefined) continue
      const target = resolveClientImport(rel, spec)
      if (target === '..' || target.startsWith('../')) continue // package-level rules govern
      const toDomain = domainOf(target)
      if (toDomain === '' || CONTRACT_DIRS.has(toDomain)) continue // top-level shared file or contract layer
      if (fromDomain === toDomain) continue // inside one domain
      violations.push({
        file: `${pkgName}/src/client/${rel}`,
        imported: spec,
        reason: fromDomain === ''
          ? `top-level non-assembly file imports domain "${toDomain}" (only apply/index may assemble)`
          : `domain "${fromDomain}" imports sibling domain "${toDomain}" (route shared API through contract/)`,
      })
    }
  }
  return violations
}

function main(): void {
  const violations: Violation[] = []
  for (const pkg of readdirSync(CLIENT_DIR)) {
    const clientDir = join(CLIENT_DIR, pkg, 'src/client')
    try {
      if (!statSync(clientDir).isDirectory()) continue
    } catch {
      // No client half in this package — nothing to layer-check.
      continue
    }
    violations.push(...checkPackage(pkg, clientDir))
  }

  const audit = auditDomainViolations(violations)
  if (audit.regressions.length > 0 || audit.staleBudgets.length > 0) {
    console.error('verify-client-domain-graph: domain layering ratchet changed:')
    for (const item of audit.regressions) {
      console.error(`  REGRESSION ${item.key} (actual ${item.actual}, budget ${item.allowed})`)
    }
    for (const item of audit.staleBudgets) {
      console.error(`  REDUCE BUDGET ${item.key} (actual ${item.actual}, budget ${item.allowed})`)
    }
    process.exitCode = 1
    return
  }
  console.log(
    `verify-client-domain-graph: no new domain edges; ${audit.acceptedLegacyOccurrences} locked legacy occurrence(s).`,
  )
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
