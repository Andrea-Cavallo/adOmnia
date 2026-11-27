import type { BsonDoc } from './bson'
import { numberValue } from './ui'

export interface PlanStage {
  stage: string
  indexName?: string
  keyPattern?: BsonDoc
  children: PlanStage[]
  /** Per-stage execution stats, when the plan came from executionStats. */
  nReturned?: number | null
  docsExamined?: number | null
  keysExamined?: number | null
  timeMs?: number | null
}

export interface ExplainSummary {
  plan: PlanStage | null
  indexesUsed: string[]
  collectionScan: boolean
  inMemorySort: boolean
  nReturned: number | null
  executionTimeMillis: number | null
  totalKeysExamined: number | null
  totalDocsExamined: number | null
}

function toStage(node: BsonDoc | undefined): PlanStage | null {
  if (!node || typeof node !== 'object') return null
  // SBE plans (MongoDB 7+) wrap the classic tree in queryPlan.
  if (node.queryPlan) return toStage(node.queryPlan as BsonDoc)
  const children = [
    ...(node.inputStage ? [node.inputStage as BsonDoc] : []),
    ...((node.inputStages as BsonDoc[] | undefined) ?? []),
  ].map(toStage).filter((s): s is PlanStage => s != null)
  return {
    stage: String(node.stage ?? 'UNKNOWN'),
    indexName: typeof node.indexName === 'string' ? node.indexName : undefined,
    keyPattern: node.keyPattern as BsonDoc | undefined,
    children,
    nReturned: numberValue(node.nReturned),
    docsExamined: numberValue(node.docsExamined),
    keysExamined: numberValue(node.keysExamined),
    timeMs: numberValue(node.executionTimeMillisEstimate),
  }
}

function walk(stage: PlanStage | null, visit: (s: PlanStage) => void) {
  if (!stage) return
  visit(stage)
  stage.children.forEach((c) => walk(c, visit))
}

export function summarizeExplain(explain: BsonDoc): ExplainSummary {
  const planner = (explain.queryPlanner ?? {}) as BsonDoc
  const stats = (explain.executionStats ?? {}) as BsonDoc
  // executionStages carries per-stage numbers; SBE engines report lower-case stage names there, so fall back to the winning plan.
  const executed = stats.executionStages as BsonDoc | undefined
  const classic = !!executed && /^[A-Z_]+$/.test(String(executed.stage ?? ''))
  const plan = toStage(classic ? executed : planner.winningPlan as BsonDoc | undefined)
  const indexes: string[] = []
  let collectionScan = false
  let inMemorySort = false
  walk(plan, (s) => {
    if (s.indexName && !indexes.includes(s.indexName)) indexes.push(s.indexName)
    if (s.stage === 'COLLSCAN') collectionScan = true
    if (s.stage === 'SORT') inMemorySort = true
  })
  return {
    plan,
    indexesUsed: indexes,
    collectionScan,
    inMemorySort,
    nReturned: numberValue(stats.nReturned),
    executionTimeMillis: numberValue(stats.executionTimeMillis),
    totalKeysExamined: numberValue(stats.totalKeysExamined),
    totalDocsExamined: numberValue(stats.totalDocsExamined),
  }
}
