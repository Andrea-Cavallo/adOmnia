import type { GoIDESymbolNode } from '@/lib/code-studio-lsp-api'
import { lexJava, javaLineStarts, javaPosition, type JavaExcluded, type JavaToken } from './javaLocalLexer'

export interface JavaLocalDeclaration {
  name: string; kind: number; detail: string; offset: number
  scopeStart: number; scopeEnd: number; hoisted: boolean
}
export interface JavaLocalAnalysis {
  symbols: GoIDESymbolNode[]; declarations: JavaLocalDeclaration[]
  excluded: JavaExcluded[]; limited: boolean; length: number
}
const CACHE_SIZE = 8
const cache = new Map<string, JavaLocalAnalysis>()
const TYPES: Record<string, number> = { class: 5, interface: 11, enum: 10, record: 5 }
const NON_TYPE = new Set(['return','throw','new','case','package','import','break','continue','yield','instanceof','extends','implements','else','assert'])
const NON_METHOD = new Set(['if','for','while','switch','catch','synchronized','try','new','this','super'])
const MODIFIERS = new Set(['public','private','protected','static','final','abstract','native','synchronized','transient','volatile','default','strictfp','sealed','non','permits'])
interface Entry { node: GoIDESymbolNode; parent: number; index: number }

/** Tolerant, file-local syntax. It deliberately does not infer types or search dependencies. */
export function analyzeJavaFile(source: string): JavaLocalAnalysis {
  const hit = cache.get(source)
  if (hit) { cache.delete(source); cache.set(source, hit); return hit }
  const { tokens: t, excluded, limited } = lexJava(source)
  const result: JavaLocalAnalysis = { symbols: [], declarations: [], excluded, limited, length: source.length }
  if (limited) return result
  const lines = javaLineStarts(source)
  const pairs = new Map<number, number>(), parents = new Map<number, number>(), owner: number[] = []
  const braces: number[] = [], parens: number[] = [], brackets: number[] = []
  for (let i = 0; i < t.length; i++) {
    owner[i] = braces[braces.length - 1] ?? -1
    const text = t[i].text
    if (text === '{') { parents.set(i, owner[i]); braces.push(i) }
    if (text === '(') parens.push(i)
    if (text === '[') brackets.push(i)
    const stack = text === '}' ? braces : text === ')' ? parens : text === ']' ? brackets : null
    if (stack?.length) { const open = stack.pop()!; pairs.set(open, i); pairs.set(i, open) }
  }
  const scopeEnd = (scope: number) => scope < 0 ? source.length : pairs.has(scope) ? t[pairs.get(scope)!].end : source.length
  const scopeStart = (scope: number) => scope < 0 ? 0 : t[scope].start
  const range = (start: number, end: number) => {
    const a = javaPosition(lines, start), b = javaPosition(lines, end)
    return { startLine: a.line, startColumn: a.column, endLine: b.line, endColumn: b.column }
  }
  const nodeFor = (token: JavaToken, kind: number, end: number, detail = '', name = token.text): GoIDESymbolNode => ({ name, kind, detail, range: range(token.start, end), selectionRange: range(token.start, token.end), children: [] })
  const entries: Entry[] = [], scopeNodes = new Map<number, GoIDESymbolNode>(), typeScopes = new Set<number>()
  const declarationTokens = new Set<number>(), parameterScope = new Map<number, number>()
  const statementStart = (i: number) => { let a = i - 1; while (a >= 0 && ![';','{','}'].includes(t[a].text)) a--; return a + 1 }
  const add = (i: number, kind: number, detail: string, scope: number, hoisted: boolean) => {
    if (declarationTokens.has(i)) return
    declarationTokens.add(i)
    result.declarations.push({ name: t[i].text, kind, detail, offset: t[i].start, scopeStart: scopeStart(scope), scopeEnd: scopeEnd(scope), hoisted })
  }
  // Named types, including nested/local types. Skip .class literals and annotation uses.
  for (let i = 0; i < t.length; i++) {
    const kind = TYPES[t[i].text]
    if (!kind || !t[i + 1]?.identifier || t[i - 1]?.text === '.') continue
    let open = i + 2
    while (open < t.length && !['{',';','}'].includes(t[open].text)) {
      if (t[open].text === '(' && pairs.has(open)) open = pairs.get(open)!
      open++
    }
    const node = nodeFor(t[i + 1], kind, t[open]?.text === '{' ? scopeEnd(open) : source.length)
    entries.push({ node, parent: owner[i], index: i })
    if (t[open]?.text === '{') { scopeNodes.set(open, node); typeScopes.add(open) }
    add(i + 1, kind, t[i].text, owner[i], true)
    // Record components are fields, visible throughout the record body.
    if (t[i].text === 'record' && t[i + 2]?.text === '(') {
      const close = pairs.get(i + 2) ?? open
      for (let k = i + 3; k < close; k++) if (t[k].identifier && [',',')'].includes(t[k + 1]?.text) && t[k - 1]?.identifier) {
        add(k, 8, t[k - 1].text, open, true)
        node.children!.push(nodeFor(t[k], 8, t[k].end, t[k - 1].text))
      }
    }
  }
  // Anonymous classes retain their methods under a distinct syntax node.
  for (let i = 0; i < t.length; i++) if (t[i].text === '{' && t[i - 1]?.text === ')') {
    const left = pairs.get(i - 1)
    if (left === undefined) continue
    let start = left - 1
    while (start >= 0 && ![';','{','}','='].includes(t[start].text) && t[start].text !== 'new') start--
    if (t[start]?.text !== 'new' || !t[start + 1]?.identifier) continue
    const node = nodeFor(t[start + 1], 5, scopeEnd(i), '', `${t[start + 1].text} (anonymous)`)
    entries.push({ node, parent: owner[i], index: i }); scopeNodes.set(i, node); typeScopes.add(i)
  }
  // Method declarations can only begin in a type's direct body, never at a nested call site.
  for (let i = 0; i < t.length; i++) {
    if (declarationTokens.has(i) || !t[i].identifier || t[i + 1]?.text !== '(' || !typeScopes.has(owner[i]) || NON_METHOD.has(t[i].text) || t[i - 1]?.text === '.' || t[i - 1]?.text === '@') continue
    const close = pairs.get(i + 1)
    if (close === undefined) continue
    const begin = statementStart(i)
    // Annotation arguments (`@GetMapping(value = "/x")`) may contain `=`; only look outside parentheses.
    let initializer = false
    for (let k = begin; k < i; k++) {
      if (t[k].text === '(' && pairs.has(k)) k = pairs.get(k)!
      else if (t[k].text === '=' || t[k].text === 'new') { initializer = true; break }
    }
    if (initializer) continue
    let end = close + 1
    if (t[end]?.text === 'throws') while (end < t.length && !['{',';','}'].includes(t[end].text)) end++
    if (!['{',';'].includes(t[end]?.text)) continue
    const type = scopeNodes.get(owner[i])!
    const kind = type.name === t[i].text ? 9 : 6
    const detail = source.slice(t[i + 1].start, t[close].end).replace(/\s+/g, ' ')
    const method = nodeFor(t[i], kind, t[end].text === '{' ? scopeEnd(end) : t[end].end, detail)
    entries.push({ node: method, parent: owner[i], index: i })
    add(i, kind, detail, owner[i], true)
    if (t[end].text === '{') {
      scopeNodes.set(end, method)
      for (let k = i + 2; k < close; k++) parameterScope.set(k, end)
    } else {
      // Abstract/interface method: parameters are not fields; scope them to the parameter list.
      for (let k = i + 2; k < close; k++) parameterScope.set(k, i + 1)
    }
  }
  // Lambda parameters belong to their body/expression, rather than the containing method.
  const lambdaScope = new Map<number, { start: number; end: number }>()
  for (let i = 0; i < t.length; i++) if (t[i].text === '-' && t[i + 1]?.text === '>') {
    let begin = i - 1
    if (t[begin]?.text === ')') begin = (pairs.get(begin) ?? begin) + 1
    const body = i + 2
    let end = body
    if (t[body]?.text === '{') end = pairs.get(body) ?? t.length - 1
    else while (end < t.length && ![';', '}'].includes(t[end].text)) end++
    const bounds = { start: t[body]?.start ?? source.length, end: t[end]?.end ?? source.length }
    for (let k = begin; k < i; k++) if (t[k]?.identifier && ([',',')','-'].includes(t[k + 1]?.text))) lambdaScope.set(k, bounds)
  }
  // Enum constants are hoisted members, including constants with constructor arguments.
  for (const scope of typeScopes) if (scopeNodes.get(scope)?.kind === 10) {
    for (let i = scope + 1; i < t.length && t[i].start < scopeEnd(scope); i++) {
      if (owner[i] !== scope) continue
      if (t[i].text === ';') break
      if (t[i].identifier && ['{',','].includes(t[i - 1]?.text) && [',',';','(','{','}'].includes(t[i + 1]?.text)) {
        add(i, 22, 'enum constant', scope, true)
        entries.push({ node: nodeFor(t[i], 22, t[i].end, 'enum constant'), parent: scope, index: i })
      }
    }
  }
  // Variables/fields/parameters: conservative declaration patterns; expressions are not declarations.
  for (let i = 1; i < t.length; i++) {
    if (!t[i].identifier || declarationTokens.has(i) || MODIFIERS.has(t[i].text)) continue
    const prev = t[i - 1], next = t[i + 1]?.text
    const lambda = lambdaScope.get(i)
    if (!lambda && (!['=', ';', ',', ')', ':', '['].includes(next) || NON_TYPE.has(prev.text) || MODIFIERS.has(prev.text))) continue
    let typed = prev.identifier || [']','>'].includes(prev.text)
    let start = i - 1
    if (t[i - 1]?.text === '.' && t[i - 2]?.text === '.' && t[i - 3]?.text === '.' && t[i - 4]?.identifier) { typed = true; start = i - 4 }
    while (start > 1 && t[start].text === ']' && t[start - 1].text === '[') start -= 2
    if (t[start]?.text === '>') {
      let depth = 1; start--
      while (start >= 0 && depth > 0) { if (t[start].text === '>') depth++; if (t[start].text === '<') depth--; start-- }
      if (depth !== 0 || start < 0 || !t[start].identifier) typed = false
    }
    while (start > 1 && t[start - 1].text === '.' && t[start - 2].identifier) start -= 2
    if (prev.text === ',') {
      start = i - 2
      while (start > 0 && ![';','{','}','('].includes(t[start].text)) start--
      typed = t.slice(start, i).some((x, n, a) => x.identifier && a[n + 1]?.identifier && !NON_TYPE.has(x.text))
    }
    if (!typed && !lambda) continue
    const scope = parameterScope.get(i) ?? owner[i]
    const field = typeScopes.has(scope) && !parameterScope.has(i) && !lambda
    const begin = statementStart(i)
    const constant = field && t.slice(begin, i).some(x => x.text === 'final')
    const kind = lambda || parameterScope.has(i) ? 13 : constant ? 14 : field ? 8 : 13
    const detail = lambda && !typed ? 'lambda parameter' : source.slice(t[Math.max(0, start)].start, t[i].start).trim().replace(/\s+/g, ' ')
    add(i, kind, detail, scope, field)
    if (lambda) {
      const declaration = result.declarations[result.declarations.length - 1]
      declaration.scopeStart = lambda.start; declaration.scopeEnd = lambda.end; declaration.hoisted = true
    }
    if (field) entries.push({ node: nodeFor(t[i], kind, t[i].end, detail), parent: scope, index: i })
  }
  entries.sort((a, b) => a.index - b.index)
  for (const entry of entries) {
    let parent = entry.parent
    while (parent >= 0 && !scopeNodes.has(parent)) parent = parents.get(parent) ?? -1
    const container = scopeNodes.get(parent)
    if (container && container !== entry.node) container.children!.push(entry.node)
    else result.symbols.push(entry.node)
  }
  cache.set(source, result)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return result
}

export function localJavaCompletions(analysis: JavaLocalAnalysis, offset: number): JavaLocalDeclaration[] {
  if (analysis.limited || analysis.excluded.some(x => offset > x.start && (offset < x.end || (offset === x.end && x.endInclusive)))) return []
  const visible = analysis.declarations.filter(x => offset >= x.scopeStart && offset <= x.scopeEnd && (x.hoisted || x.offset < offset))
  // Inner declarations shadow outer ones; overloaded methods keep a single completion name.
  visible.sort((a,b) => b.scopeStart - a.scopeStart || b.offset - a.offset)
  const names = new Set<string>()
  return visible.filter(x => { if (names.has(x.name)) return false; names.add(x.name); return true })
}
