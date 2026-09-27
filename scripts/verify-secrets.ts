/**
 * Secret-boundary gate for the repository's tracked working tree.
 *
 * WHY THIS EXISTS: credentials are meant to live outside git by policy, but
 * nothing mechanically enforced that claim. The 2026-09-27 audit of every path
 * ever added in any commit found no credential material only because it was run
 * by hand. This turns that one-off sweep into a repeatable gate so an accidental
 * key fails locally instead of reaching a remote.
 *
 * Scope discipline: matches are reported as `path:line [rule]` and the matched
 * value is never printed, so running this cannot itself leak a secret into a
 * terminal scrollback or a CI artifact. History is deliberately out of scope:
 * scanning every blob of a ~192 MB object store measured over 20 minutes, which
 * no pre-commit lane can absorb. A full-history tool (gitleaks/trufflehog) is
 * the right instrument before publishing a new remote.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

interface SecretRule {
  readonly name: string
  readonly pattern: RegExp
}

/** Shapes that indicate credential material rather than prose about credentials. */
// Lengths count the WHOLE token including its literal prefix: an OpenAI key is
// `sk-` plus roughly 40 characters, so requiring 28 after the dash made a short
// but well-formed key invisible to its own rule while a long one only passed by
// accident through the assigned-secret path. Measured with a probe on 2026-09-27.
const SECRET_RULES: readonly SecretRule[] = [
  { name: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'jwt', pattern: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // Trailing hyphen is literal: written before '~' it formed the range /-~,
  // which silently swallowed '_' and made the class duplicate (sonarjs).
  // /iu is required, not stylistic: measured on 2026-09-27, without /i the rule
  // missed API_KEY and Secret assignments entirely. The cost is that oxlint's
  // sonarjs reports a false "duplicates-in-character-class" on this line only —
  // verified minimal on /[A-Za-z0-9_+/=.~]/iu, where no character is duplicated.
  // Detection strength wins over one lint suppression on one line; the reason is
  // recorded here so the ignore below is never mistaken for a real defect.
  // eslint-disable-next-line sonarjs/duplicates-in-character-class -- false positive under /iu, see above
  { name: 'assigned-secret', pattern: /(api[_-]?key|token|secret|password|senha)\s*[:=]\s*["']?[A-Za-z0-9_+/=.~-]{24,}/iu },
]

/**
 * Fragments that mark a value as deliberate redaction bait rather than a key.
 *
 * These are matched against the extracted VALUE, never the whole line. An
 * earlier revision tested the line, so any real key that happened to contain a
 * counting run ('…1234567890…', '…abcdefghijklmnop…' — both frequent in genuine
 * keys) was silently dropped, and a probe built from exactly the alphabet was
 * missed while every stage above it reported success. Sentinels are an
 * allow-list about intent, so they may only ever cancel a finding on evidence
 * that the intent is visible in the secret-shaped text itself.
 */
const SENTINEL_MARKERS: readonly string[] = [
  'DO-NOT-LOG', 'DIAGNOSTIC-SENTINEL', 'WRITE-DIAGNOSTIC', 'NO-CREDENTIAL', 'NO-CALL',
  'DUMMY', 'PLACEHOLDER', 'MUST-NOT-REACH', 'TEST_ONLY', 'SYNTHETIC',
]


/**
 * A real provider key is high-entropy and unquoted prose. Measured on this tree
 * on 2026-09-27: the loose pattern produced 22 hits, all of them prose about a
 * credential, a CSS custom property, or a variable merely named `token`. This
 * shape test removes that class without weakening the prefix rules below.
 */
/**
 * Low-entropy tests, not a blacklist of substrings. An earlier revision rejected
 * any value containing 'abcd' or '1234', which silently blinded every prefix rule
 * to a key built from the alphabet in order — the exact shape a planted probe
 * uses, so the gate passed a leak it had just been shown to detect. Measuring
 * diversity cannot be spoofed that way: a real key is mixed by construction.
 */
const MIN_DISTINCT_CHAR_RATIO = 0.55

function looksLikeRealSecret(value: string): boolean {
  if (value.length < 24) return false
  const hasLower = /[a-z]/u.test(value)
  const hasUpper = /[A-Z]/u.test(value)
  const hasDigit = /\d/u.test(value)
  // Provider keys are alphanumeric with case variation; separators alone
  // ('hidden-lineage-session-secret') stay out of this fast path on purpose.
  if (!hasLower || !(hasUpper || hasDigit)) return false
  const distinct = new Set(value).size
  if (distinct / value.length < MIN_DISTINCT_CHAR_RATIO) return false
  // A single repeated character is never a key.
  return !/^(.)\1+$/u.test(value)
}


/**
 * Assigned values that are not secrets. Every entry was read in context and is
 * one of: a redaction fixture naming what it expects to hide, a GitHub Actions
 * expression the runner resolves, an identifier or path, or a literal already
 * carrying a sentinel fragment. Entries are matched case-insensitively because
 * some fixtures differ only in casing. The list stays explicit on purpose — a
 * future real key must not be able to hide in it by resemblance.
 */
const APPROVED_SYNTHETICS: readonly string[] = [
  // Redaction fixtures naming the payload they expect to be hidden.
  'sk-\u{1F600}pasted-from-a-chat-window',
  'conflict with hidden-authorization-session-secret',
  'hidden-lineage-session-secret',
  'title batch failed beside hidden-title-session-secret',
  'conflict at hidden-parent-preauthorization-secret',
  'conflict at hidden-parent-prompt-instructions-secret',
  'nested secret from the child session',
  // CI expressions resolved by the runner, never a literal key.
  '${{ secrets.E2B_API_KEY_EXTERNAL }}',
  '${{ secrets.E2B_API_KEY_INTERNAL }}',
  // A long path used to force table wrapping, and a catalog identifier.
  'workspace/deepseek-harness/packages/client/ui-primitives/src/markdown/render.tsx/',
  'client-face slash-input protocol',
]

const APPROVED_LOWER = new Set(APPROVED_SYNTHETICS.map(value => value.toLowerCase()))

/** True when the assigned value is a reviewed non-secret (substring form). */
function isApprovedSynthetic(value: string): boolean {
  const lowered = value.toLowerCase()
  for (const approved of APPROVED_LOWER) {
    if (lowered.includes(approved) || approved.includes(lowered)) return true
  }
  return false
}

/**
 * A provider-prefixed shape alone is not evidence of a live key. Two exclusions
 * were measured on 2026-09-27 and run before any allow-comment, so a real key
 * cannot hide behind them:
 *
 * 1. Environment references. `apiKey: process.env.DEEPSEEK_API_KEY` contains the
 *    literal `sk-DEEPSEEK_API_KEY` inside its own identifier name, so flagging it
 *    would mean annotating code that merely reads a credential.
 * 2. Fixtures declaring themselves. Names such as FIXTURE_SECRET and values like
 *    '…e2efixture…' state their intent, which is what a sentinel is for.
 */
const ENV_REFERENCE = /process\.env\.[A-Z0-9_]+/u

/**
 * A value that names itself as test material. Broader than the sentinel list but
 * still narrow in practice: no provider ships a key containing the word
 * "fixture", so this cannot mask a real one while it covers the suites' own
 * naming convention (FIXTURE_SECRET, sk-proj-fake-…) without per-line comments.
 */
const SELF_DECLARING = /fixture|synthetic|-fake-|fakekey|\bfaux\b/iu

function reportedRule(line: string, name: string, pattern: RegExp): boolean {
  if (line.match(pattern) === null) return false
  if (ENV_REFERENCE.test(line)) return false
  const value = matchedValue(line, pattern) ?? assignedValue(line)
  if (value === undefined) return true
  const resolved = unescapeLiteral(value)
  if (SELF_DECLARING.test(resolved)) return false
  if (isApprovedSynthetic(resolved)) return false
  if (SENTINEL_MARKERS.some(marker => resolved.toUpperCase().includes(marker))) return false
  // The prose rule additionally requires entropy; prefix shapes are already
  // specific enough that low-entropy fixtures are removed by the checks above.
  if (name === 'assigned-secret') return looksLikeRealSecret(resolved)
  return true
}

/** The literal matched by a rule, so checks apply to the key not the sentence. */
function matchedValue(line: string, pattern: RegExp): string | undefined {
  const match = line.match(pattern)
  const first = match?.[0]
  return typeof first === 'string' ? first : undefined
}


/**
 * Source escapes such as `'sk-\u{1F600}pasted'` are written literally in the
 * file, so a raw comparison against the decoded fixture never matches. Unescape
 * conservatively — only `\u{...}`, `\uXXXX`, and the common single-char forms —
 * because a real key contains none of them and an over-eager decoder could turn
 * an unrelated string into one that resembles an approved entry.
 */
const ESCAPE_PATTERN = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\(n|t|r|0|\\|'|")/g

export function unescapeLiteral(value: string): string {
  if (!value.includes('\\')) return value
  return value.replace(ESCAPE_PATTERN, (whole, brace: string | undefined, four: string | undefined, named: string | undefined) => {
    if (brace !== undefined) return String.fromCodePoint(Number.parseInt(brace, 16))
    if (four !== undefined) return String.fromCharCode(Number.parseInt(four, 16))
    switch (named) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case '0': return '\0'
      default: return named ?? whole
    }
  })
}





function git(args: readonly string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

/**
 * Paths to scan: tracked files plus untracked ones that are not ignored.
 *
 * Tracked-only would be a hole rather than a shortcut. The commit that
 * introduces a leaked key adds the file in the same change, so a pre-commit or
 * CI lane must see it before it is history. Measured directly on 2026-09-27: an
 * untracked planted key was invisible to a tracked-only scan.
 */
export function scannedPaths(root: string): string[] {
  const tracked = git(['ls-files']).split('\n').filter(path => path !== '')
  // --exclude-standard honours .gitignore, so build output and dependencies are
  // never walked; without it the listing alone stalls the run. Measured on this
  // tree: 43 untracked files in ~0.2 s. Note `-c` means --cached (tracked), not
  // "include ignored" — passing it does not widen the set at all.
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(path => path !== '')
  return [...new Set([...tracked, ...untracked])]
    .filter(path => /\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|toml|env|ps1|md|py)$/.test(path))
    .map(path => `${root}/${path.replace(/\\/g, '/')}`)
    .filter(absolute => existsSync(absolute))
}


/** Extracts only the assigned value so the shape test cannot match prose. */
function assignedValue(line: string): string | undefined {
  const match = /(?:api[_-]?key|token|secret|password|senha)["']?\s*[:=]\s*["']([^"']{24,})["']/iu.exec(line)
  return match?.[1]
}

/**
 * Suppression comment, in the shape `verify-secrets: allow <reason>`.
 *
 * Prefix rules cannot separate a redaction fixture from a live key by shape
 * alone: measured on 2026-09-27, all 21 remaining findings were deliberate test
 * bait, and any entropy heuristic loose enough to accept them would also accept
 * a real key. So the decision is made explicit at each site instead of guessed
 * here. Requiring a non-empty reason keeps the marker self-documenting, and an
 * unannotated new key still fails the gate.
 */
const ALLOW_COMMENT = /\/\/[^\n]*verify-secrets:\s*allow\s+(\S[^\n]*)/u

/** Rules matching one file, with line numbers and no echoed value. */
export function findSecrets(path: string): Array<{ rule: string; line: number }> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const findings: Array<{ rule: string; line: number }> = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line === '') continue
    for (const { name, pattern } of SECRET_RULES) {
      if (!reportedRule(line, name, pattern)) continue
      // A fixture that states its intent on the same line is allowed; a bare
      // key-shaped value is not.
      if (ALLOW_COMMENT.test(line)) continue
      findings.push({ rule: name, line: index + 1 })
    }
  }
  return findings
}

/** Runs the scan and returns the process exit code. */
export function runVerifySecrets(): number {
  const root = git(['rev-parse', '--show-toplevel']).trim()
  const candidates = scannedPaths(root)
  const offenders: Array<{ path: string; findings: ReturnType<typeof findSecrets> }> = []
  for (const absolute of candidates) {
    const findings = findSecrets(absolute)
    if (findings.length > 0) offenders.push({ path: absolute.slice(root.length + 1), findings })
  }

  if (offenders.length === 0) {
    console.log(`verify-secrets: ${String(candidates.length)} files scanned, no credential-shaped value found.`)
    return 0
  }
  console.error(`verify-secrets: ${String(offenders.length)} file(s) contain credential-shaped values:`)
  for (const offender of offenders) {
    for (const finding of offender.findings.slice(0, 5)) {
      console.error(`  ${offender.path}:${String(finding.line)}  [${finding.rule}]`)
    }
  }
  console.error('Move the value to a credential reference, or mark a synthetic fixture with a known sentinel.')
  return 1
}

// Importing this module must not scan or set an exit code: a unit test that
// exercises one rule would otherwise inherit the whole CLI's side effects.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runVerifySecrets()
}
