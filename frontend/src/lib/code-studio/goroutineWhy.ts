import type { GoIDEDebugFrame, GoIDEDebugVariable } from '@/lib/code-studio-debug-api'

export interface GoroutineOrigin {
  request: { route: string; handler: string } | null
  message: { topics: string[]; consumer: string } | null
}

interface RouteLike { label: string; attrs: Record<string, string> }
interface EntryLike { kind: string; function?: string; topics?: string[] }

const shortName = (name: string) => name.slice(name.lastIndexOf('/') + 1).replace(/^[^.]+\./, '').replace(/[()*]/g, '')

/**
 * Where a goroutine comes from, read from its stack: a frame of net/http's connection server with a
 * route handler of the project above it (born from a request), or a message consumer function.
 */
export function goroutineOrigin(frames: readonly Pick<GoIDEDebugFrame, 'name'>[], routes: readonly RouteLike[], entries: readonly EntryLike[]): GoroutineOrigin {
  const names = frames.map((frame) => frame.name)
  const serving = names.some((name) => /(?:^|\/)http\.\(\*conn\)\.serve|(?:^|\/)http\.HandlerFunc\.ServeHTTP|google\.golang\.org\/grpc|fasthttp|gin-gonic|labstack\/echo|gofiber/.test(name))
  let request: GoroutineOrigin['request'] = null
  // A route handler on the stack is enough (summaries may keep only project frames); net/http frames without one still mean a request.
  for (const name of names) {
    const short = shortName(name)
    const route = routes.find((item) => {
      const decl = item.attrs.declName ? shortName(item.attrs.declName) : ''
      return decl && (short === decl || short.endsWith(`.${decl}`) || short.startsWith(`${decl}.func`))
    })
    if (route) { request = { route: route.label, handler: short }; break }
  }
  if (serving) {
    if (!request) request = { route: 'an HTTP request', handler: shortName(names.find((name) => !/^(runtime|net\/http|internal\/)/.test(name)) ?? names[0] ?? '') }
  }
  let message: GoroutineOrigin['message'] = null
  for (const name of names) {
    const short = shortName(name)
    const consumer = entries.find((entry) => /-consumer$/.test(entry.kind) && entry.function && (short === shortName(entry.function) || short.startsWith(`${shortName(entry.function)}.func`)))
    if (consumer) { message = { topics: consumer.topics ?? [], consumer: short }; break }
  }
  return { request, message }
}

export interface ContextLink { type: string; deadline?: string }

/** "context.Context(*context.timerCtx) 0xc00…" → "*context.timerCtx". */
export function contextType(variable: Pick<GoIDEDebugVariable, 'value' | 'type'>): string | null {
  const text = `${variable.type ?? ''} ${variable.value}`
  const concrete = /\((\*?context\.\w+)\)/.exec(text)?.[1] ?? /(\*?context\.(?:cancelCtx|timerCtx|valueCtx|backgroundCtx|todoCtx|emptyCtx|withoutCancelCtx|afterFuncCtx|stopCtx))/.exec(text)?.[1]
  if (concrete) return concrete
  return /context\.Context/.test(text) ? 'context.Context' : null
}

/** How the context can be cancelled, from the chain (innermost first). */
export function cancellationPath(chain: readonly ContextLink[]): string[] {
  const reasons: string[] = []
  for (const link of chain) {
    if (/timerCtx/.test(link.type)) reasons.push(`its deadline${link.deadline ? ` (${link.deadline})` : ''} expires`)
    else if (/cancelCtx|afterFuncCtx/.test(link.type)) reasons.push('someone calls its cancel function (WithCancel), or the request or shutdown that owns it ends')
    else if (/withoutCancelCtx/.test(link.type)) { reasons.push('nothing above it: WithoutCancel detaches it from its parent'); break }
    else if (/background|todo|emptyCtx/.test(link.type)) break
  }
  return reasons.length ? reasons : ['never: it derives only from context.Background() / TODO()']
}

/**
 * The context a goroutine holds: the first variable of type context.* in its project frames, walked
 * to its parents through the debugger (Context / cancelCtx fields), with the deadline of timer contexts.
 */
export async function contextChainOf(debugId: string, goroutineId: number): Promise<{ frame: string; variable: string; chain: ContextLink[] } | null> {
  const { getGoIDEDebugStack, getGoIDEDebugScopes, getGoIDEDebugVariables } = await import('@/lib/code-studio-debug-api')
  const all = await getGoIDEDebugStack(debugId, goroutineId)
  const frames = all.filter((frame) => frame.relativePath).slice(0, 6)
  for (const frame of frames) {
    const scopes = await getGoIDEDebugScopes(debugId, frame.id).catch(() => [])
    for (const scope of scopes.filter((item) => !item.expensive && item.variablesReference > 0)) {
      const variables = await getGoIDEDebugVariables(debugId, scope.variablesReference)
      const variable = variables.find((item) => contextType(item))
      if (!variable) continue
      const chain: ContextLink[] = []
      let current: GoIDEDebugVariable | undefined = variable
      for (let depth = 0; current && depth < 12; depth++) {
        const type = contextType(current)
        if (type && type !== 'context.Context' && chain[chain.length - 1]?.type !== type) chain.push({ type })
        if (!current.variablesReference) break
        const children = await getGoIDEDebugVariables(debugId, current.variablesReference)
        const deadline = children.find((child) => child.name === 'deadline')
        const timer = [...chain].reverse().find((link) => /timerCtx/.test(link.type))
        if (deadline && timer && !timer.deadline) timer.deadline = /\d{4}-\d\d-\d\dT[\d:]+/.exec(deadline.value)?.[0].replace('T', ' ') ?? deadline.value.slice(0, 40)
        // Interfaccia → valore concreto, poi il genitore: campo Context, o cancelCtx incluso nel timerCtx.
        current = children.find((child) => child.name === 'Context' || child.name === 'parent')
          ?? children.find((child) => child.name === 'cancelCtx')
          ?? (children.length === 1 && contextType(children[0]) ? children[0] : undefined)
      }
      return { frame: frame.name, variable: variable.name, chain }
    }
  }
  return null
}
