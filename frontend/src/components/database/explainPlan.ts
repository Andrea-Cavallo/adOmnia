// Turns the rows of EXPLAIN / EXPLAIN ANALYZE into a plan tree, per driver.
import type { DbResult } from './dbShared'

export interface PlanNode {
  label: string
  detail?: string
  metrics: [string, string][]
  /** Cost or measured time used for the relative bar (0 = unknown). */
  weight: number
  warn?: string
  children: PlanNode[]
}

export interface ExecutionPlan {
  nodes: PlanNode[]
  summary: [string, string][]
}

const FULL_SCAN = 'Full scan'

function sqlitePlan(rows: Record<string, unknown>[]): ExecutionPlan {
  const byId = new Map<number, PlanNode>()
  const roots: PlanNode[] = []
  for (const row of rows) {
    const detail = String(row.detail ?? '')
    const node: PlanNode = {
      label: detail,
      metrics: [],
      weight: 0,
      warn: /^SCAN\b/.test(detail) && !/USING (COVERING )?INDEX/.test(detail) ? FULL_SCAN : undefined,
      children: [],
    }
    byId.set(Number(row.id), node)
    const parent = byId.get(Number(row.parent))
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return { nodes: roots, summary: [] }
}

type PgNode = Record<string, unknown> & { Plans?: PgNode[] }

function pgNode(n: PgNode): PlanNode {
  const num = (k: string) => (typeof n[k] === 'number' ? (n[k] as number) : undefined)
  const rel = n['Relation Name'] ? ` on ${n['Relation Name']}` : ''
  const conds = ['Index Name', 'Index Cond', 'Filter', 'Join Filter', 'Hash Cond', 'Merge Cond', 'Sort Key']
    .filter((k) => n[k] !== undefined)
    .map((k) => `${k}: ${Array.isArray(n[k]) ? (n[k] as unknown[]).join(', ') : String(n[k])}`)
  const metrics: [string, string][] = []
  if (num('Total Cost') !== undefined) metrics.push(['cost', `${num('Startup Cost')}..${num('Total Cost')}`])
  if (num('Plan Rows') !== undefined) metrics.push(['est. rows', String(num('Plan Rows'))])
  const actualTime = num('Actual Total Time')
  const loops = num('Actual Loops') ?? 1
  if (actualTime !== undefined) metrics.push(['time', `${actualTime} ms`])
  if (num('Actual Rows') !== undefined) metrics.push(['rows', String(num('Actual Rows'))])
  if (loops > 1) metrics.push(['loops', String(loops)])
  let warn = n['Node Type'] === 'Seq Scan' ? FULL_SCAN : undefined
  const est = num('Plan Rows')
  const actual = num('Actual Rows')
  if (est !== undefined && actual !== undefined) {
    const ratio = Math.max(est, 1) / Math.max(actual, 1)
    if (ratio >= 10 || ratio <= 0.1) warn = `Row estimate off ×${Math.round(Math.max(ratio, 1 / ratio))}`
  }
  return {
    label: `${n['Node Type'] ?? 'Node'}${rel}`,
    detail: conds.join(' · ') || undefined,
    metrics,
    weight: actualTime !== undefined ? actualTime * loops : num('Total Cost') ?? 0,
    warn,
    children: (n.Plans ?? []).map(pgNode),
  }
}

function postgresPlan(rows: Record<string, unknown>[]): ExecutionPlan | null {
  let raw = rows[0]?.['QUERY PLAN']
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  const top = Array.isArray(raw) ? (raw[0] as Record<string, unknown>) : null
  if (!top?.Plan) return null
  const summary: [string, string][] = []
  for (const k of ['Planning Time', 'Execution Time']) {
    if (typeof top[k] === 'number') summary.push([k, `${top[k]} ms`])
  }
  return { nodes: selfWeights([pgNode(top.Plan as PgNode)]), summary }
}

function mysqlTable(rows: Record<string, unknown>[]): ExecutionPlan {
  return {
    nodes: rows.map((r) => ({
      label: `${r.select_type ?? 'SIMPLE'} ${r.table ?? ''}`.trim(),
      detail: [`type: ${r.type ?? '-'}`, r.key ? `key: ${r.key}` : 'no index', r.Extra ? String(r.Extra) : ''].filter(Boolean).join(' · '),
      metrics: [['est. rows', String(r.rows ?? '-')], ['filtered', `${r.filtered ?? '-'}%`]],
      weight: Number(r.rows) || 0,
      warn: r.type === 'ALL' ? FULL_SCAN : undefined,
      children: [],
    })),
    summary: [],
  }
}

/** MySQL EXPLAIN ANALYZE / FORMAT=TREE: "-> Node (cost=… rows=…) (actual time=a..b rows=n loops=l)", 4-space indent. */
export function mysqlTree(text: string): PlanNode[] {
  const measured = text.includes('(actual time=')
  const roots: PlanNode[] = []
  const stack: { depth: number; node: PlanNode }[] = []
  for (const line of text.split('\n')) {
    const m = /^(\s*)-> (.*)$/.exec(line)
    if (!m) continue
    const depth = m[1].length
    const body = m[2]
    const label = body.replace(/\s*\((cost|actual)[^)]*\)/g, '').trim()
    const cost = /\(cost=([\d.]+) rows=([\d.e+]+)\)/.exec(body)
    const actual = /\(actual time=([\d.]+)\.\.([\d.]+) rows=([\d.e+]+) loops=(\d+)\)/.exec(body)
    const metrics: [string, string][] = []
    if (cost) metrics.push(['cost', cost[1]], ['est. rows', cost[2]])
    if (actual) metrics.push(['time', `${actual[2]} ms`], ['rows', actual[3]], ['loops', actual[4]])
    const node: PlanNode = {
      label,
      metrics,
      // A step "never executed" in a measured plan costs nothing; do not mix estimates into measured time.
      weight: actual ? Number(actual[2]) * Number(actual[4]) : !measured && cost ? Number(cost[1]) : 0,
      warn: /^Table scan\b/.test(label) ? FULL_SCAN : undefined,
      children: [],
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ depth, node })
  }
  return selfWeights(roots)
}

/** Engines report inclusive cost/time: keep only each step's own share so the hot step is the real culprit. */
function selfWeights(nodes: PlanNode[]): PlanNode[] {
  return nodes.map((n) => {
    const children = selfWeights(n.children)
    const inclusive = n.children.reduce((sum, c) => sum + c.weight, 0)
    return { ...n, weight: Math.max(0, n.weight - inclusive), children }
  })
}

export function parsePlan(result: DbResult): ExecutionPlan | null {
  const rows = result.rows ?? []
  if (!result.explain || !rows.length) return null
  const cols = result.columns ?? []
  if (result.driver === 'sqlite' && cols.includes('detail')) return sqlitePlan(rows)
  if (result.driver === 'postgres') return postgresPlan(rows)
  if (result.driver === 'mysql') {
    if (cols.includes('select_type')) return mysqlTable(rows)
    const nodes = mysqlTree(String(rows[0][cols[0]] ?? ''))
    return nodes.length ? { nodes, summary: [] } : null
  }
  return null
}

export function maxWeight(nodes: PlanNode[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.weight, maxWeight(n.children)), 0)
}
