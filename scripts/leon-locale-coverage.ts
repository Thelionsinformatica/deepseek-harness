/**
 * Compare the pt-BR language pack with every English client dictionary
 * registered through ctx.locale.register, read statically from the client
 * sources. Run after an upstream upgrade: it lists English keys the pack does
 * not translate yet (shown in English until translated), keys the pack still
 * carries that upstream removed, and placeholder mismatches.
 * Usage: pnpm run leon:locale-coverage [--strict]
 */
import ts from 'typescript'
import { dictionaries } from '../packages/client/language-pt-br/src/client/dictionaries.ts'

const configPath = ts.findConfigFile('.', file => ts.sys.fileExists(file), 'tsconfig.client.json')
if (configPath === undefined) throw new Error('tsconfig.client.json not found')

/** Collect root files of a solution config and every referenced project. */
function rootFiles(path: string, seen = new Set<string>()): { files: string[]; options: ts.CompilerOptions } {
  const config = ts.getParsedCommandLineOfConfigFile(path, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
  if (config === undefined) return { files: [], options: {} }
  const files = [...config.fileNames]
  for (const reference of config.projectReferences ?? []) {
    const refPath = ts.resolveProjectReferencePath(reference)
    if (seen.has(refPath)) continue
    seen.add(refPath)
    files.push(...rootFiles(refPath, seen).files)
  }
  return { files, options: config.options }
}

const { files, options } = rootFiles(configPath)
const sourceFiles = files.filter(f => !/[\\/](tests?|node_modules|lib)[\\/]/.test(f) && /\.(ts|tsx)$/.test(f))
const program = ts.createProgram(sourceFiles, { ...options, noEmit: true })
const checker = program.getTypeChecker()

type Dict = Record<string, string>
const out: Record<string, { en?: Dict; zh?: Dict; sources: string[]; unresolved: string[] }> = {}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)) {
    current = current.expression
  }
  return current
}

/** Resolve an expression to its object literal, following identifiers, imports, and aliases. */
function resolveObject(node: ts.Expression, depth = 0): ts.ObjectLiteralExpression | undefined {
  const expr = unwrap(node)
  if (ts.isObjectLiteralExpression(expr)) return expr
  if (depth > 8) return undefined
  if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
    let symbol = checker.getSymbolAtLocation(expr)
    if (symbol === undefined) return undefined
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        const found = resolveObject(declaration.initializer, depth + 1)
        if (found !== undefined) return found
      }
      if (ts.isShorthandPropertyAssignment(declaration)) {
        const value = checker.getShorthandAssignmentValueSymbol(declaration)
        for (const inner of value?.declarations ?? []) {
          if (ts.isVariableDeclaration(inner) && inner.initializer !== undefined) {
            const found = resolveObject(inner.initializer, depth + 1)
            if (found !== undefined) return found
          }
        }
      }
    }
  }
  return undefined
}

/** Evaluate a string-valued dictionary literal; reports keys it cannot read statically. */
function evaluateDict(literal: ts.ObjectLiteralExpression, unresolved: string[], where: string, depth = 0): Dict {
  const dict: Dict = {}
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      const inner = resolveObject(property.expression)
      if (inner !== undefined && depth < 8) Object.assign(dict, evaluateDict(inner, unresolved, where, depth + 1))
      else unresolved.push(`${where}: spread ${property.expression.getText()}`)
      continue
    }
    if (!ts.isPropertyAssignment(property)) { unresolved.push(`${where}: ${property.getText().slice(0, 60)}`); continue }
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
      ? property.name.text
      : undefined
    const value = unwrap(property.initializer)
    if (name !== undefined && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) dict[name] = value.text
    else unresolved.push(`${where}: ${name ?? property.name.getText()}`)
  }
  return dict
}

function stringValue(node: ts.Expression): string | undefined {
  const type = checker.getTypeAtLocation(node)
  return type.isStringLiteral() ? type.value : undefined
}

for (const file of program.getSourceFiles()) {
  if (file.isDeclarationFile || !sourceFiles.some(f => f.replaceAll('\\', '/') === file.fileName)) continue
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register'
      && /\blocale$/.test(node.expression.expression.getText())) {
      const [nsArg, second, third] = node.arguments
      const ns = nsArg === undefined ? undefined : stringValue(nsArg)
      const where = `${file.fileName.replace(/.*packages[\\/]/,
        'packages/')}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      if (ns === undefined) { (out['?'] ??= { sources: [], unresolved: [] }).unresolved.push(`${where}: namespace not static`) }
      else {
        const entry = (out[ns] ??= { sources: [], unresolved: [] })
        entry.sources.push(where)
        const put = (locale: string, expr: ts.Expression | undefined): void => {
          if (expr === undefined) return
          const literal = resolveObject(expr)
          if (literal === undefined) { entry.unresolved.push(`${where}: ${locale} dictionary not static`); return }
          const dict = evaluateDict(literal, entry.unresolved, `${where} ${locale}`)
          if (locale === 'en') entry.en = { ...entry.en, ...dict }
          if (locale === 'zh') entry.zh = { ...entry.zh, ...dict }
        }
        if (second !== undefined && third !== undefined) put(stringValue(second) ?? '?', third)
        else if (second !== undefined) {
          const dicts = resolveObject(second)
          if (dicts === undefined) entry.unresolved.push(`${where}: dictionary map not static`)
          else for (const property of dicts.properties) {
            if (ts.isShorthandPropertyAssignment(property)) {
              let value = checker.getShorthandAssignmentValueSymbol(property)
              if (value !== undefined && value.flags & ts.SymbolFlags.Alias) value = checker.getAliasedSymbol(value)
              const declaration = value?.declarations?.find(ts.isVariableDeclaration)
              if (declaration?.initializer !== undefined) put(property.name.text, declaration.initializer)
              else entry.unresolved.push(`${where}: ${property.name.text} shorthand not resolved`)
            }
            else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)))
              put(property.name.text, property.initializer)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}

const missing: string[] = []
const stale: string[] = []
const placeholders: string[] = []
const placeholderSet = (text: string): string => (text.match(/{w+}/g) ?? []).sort().join(',')
for (const [namespace, entry] of Object.entries(out)) {
  if (namespace === '?') continue
  const translated = dictionaries[namespace] ?? {}
  for (const [key, english] of Object.entries(entry.en ?? {})) {
    const value = translated[key]
    if (value === undefined) missing.push(`${namespace}.${key}`)
    else if (placeholderSet(value) !== placeholderSet(english)) placeholders.push(`${namespace}.${key}`)
  }
}
for (const [namespace, translated] of Object.entries(dictionaries)) {
  const english = out[namespace]?.en ?? {}
  for (const key of Object.keys(translated)) if (!(key in english)) stale.push(`${namespace}.${key}`)
}
const englishCount = Object.entries(out).filter(([k]) => k !== '?').reduce((n, [, e]) => n + Object.keys(e.en ?? {}).length, 0)
console.log(`leon-locale-coverage: ${englishCount - missing.length}/${englishCount} English strings translated; ${missing.length}
  missing, ${stale.length} stale, ${placeholders.length} placeholder mismatches`)
for (const [label, list] of [['missing', missing], ['stale', stale], ['placeholders', placeholders]] as const) {
  for (const item of list.slice(0, 40)) console.log(`  ${label}: ${item}`)
}
if (process.argv.includes('--strict') && (missing.length + stale.length + placeholders.length) > 0) process.exitCode = 1
