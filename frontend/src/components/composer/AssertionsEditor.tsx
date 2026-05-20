import { useState } from 'react'
import { Plus, X, Code, Check } from 'lucide-react'
import type { RequestAssertion, AssertionOperator } from '@/lib/types'
import { blankAssertion, pmCompatSnippet } from '@/lib/assertionEngine'
import { cn } from '@/lib/utils'

const TARGET_OPTIONS: { value: RequestAssertion['target']; label: string }[] = [
  { value: 'statusCode', label: 'Status Code' },
  { value: 'responseTime', label: 'Response Time' },
  { value: 'header', label: 'Header' },
  { value: 'bodyText', label: 'Body Text' },
  { value: 'jsonPath', label: 'JSON Path' },
  { value: 'arrayLength', label: 'Array Length' },
  { value: 'xmlPath', label: 'XML Path' },
  { value: 'contentType', label: 'Content-Type' },
  { value: 'schema', label: 'Schema' },
]

const OPERATOR_LABELS: Record<AssertionOperator, string> = {
  eq: 'equals',
  neq: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  contains: 'contains',
  not_contains: '!contains',
  regex: 'matches',
  exists: 'exists',
  type: 'type',
}

const TYPE_OPTIONS: { value: RequestAssertion['type']; label: string }[] = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
]

function operatorsForTarget(target: RequestAssertion['target']): AssertionOperator[] {
  switch (target) {
    case 'statusCode': return ['eq', 'neq', 'gt', 'lt', 'contains']
    case 'responseTime': return ['lt', 'lte', 'gt', 'eq']
    case 'header': return ['exists', 'eq', 'contains', 'not_contains', 'regex']
    case 'bodyText': return ['contains', 'not_contains', 'regex', 'exists']
    case 'jsonPath': return ['exists', 'eq', 'neq', 'contains', 'regex', 'type', 'gt', 'lt', 'lte', 'gte']
    case 'arrayLength': return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte']
    case 'xmlPath': return ['exists', 'eq', 'contains', 'regex']
    case 'contentType': return ['contains', 'eq', 'exists']
    case 'schema': return ['eq']
  }
}

function needsPath(target: RequestAssertion['target']): boolean {
  return target === 'jsonPath' || target === 'xmlPath' || target === 'arrayLength'
}

function needsHeaderName(target: RequestAssertion['target']): boolean {
  return target === 'header'
}

function needsExpected(op: AssertionOperator): boolean {
  return op !== 'exists'
}

function needsType(op: AssertionOperator): boolean {
  return op === 'type'
}

interface Props {
  assertions: RequestAssertion[]
  onChange: (assertions: RequestAssertion[]) => void
}

export function AssertionsEditor({ assertions, onChange }: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const update = (idx: number, patch: Partial<RequestAssertion>) => {
    onChange(assertions.map((a, i) => i === idx ? { ...a, ...patch } : a))
  }

  const remove = (idx: number) => {
    onChange(assertions.filter((_, i) => i !== idx))
  }

  const add = () => {
    onChange([...assertions, blankAssertion()])
  }

  const handleCopySnippet = async (idx: number) => {
    const snippet = pmCompatSnippet(assertions[idx])
    try { await navigator.clipboard.writeText(snippet) } catch { /* */ }
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {assertions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <p className="text-xs text-text-4">No test assertions</p>
          <p className="text-[10px] text-text-4">Add assertions to validate response data automatically</p>
        </div>
      )}

      {assertions.map((a, i) => {
        const ops = operatorsForTarget(a.target)
        const operatorIdx = ops.indexOf(a.operator)
        const effectiveOp = operatorIdx >= 0 ? a.operator : ops[0]

        if (effectiveOp !== a.operator) {
          update(i, { operator: effectiveOp })
        }

        return (
          <div
            key={a.id}
            className={cn(
              'flex flex-col gap-1.5 border rounded p-2',
              a.enabled ? 'border-border-1 bg-surface-1' : 'border-border-1 bg-surface-0 opacity-60'
            )}
          >
            {/* Row 1: toggle + target + operator + delete */}
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                className="w-3 h-3 accent-accent flex-shrink-0"
              />
              <select
                value={a.target}
                onChange={(e) => {
                  const newTarget = e.target.value as RequestAssertion['target']
                  const newOps = operatorsForTarget(newTarget)
                  update(i, { target: newTarget, operator: newOps[0], path: '', headerName: '', expected: '' })
                }}
                className="h-6 px-1 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 flex-shrink-0"
              >
                {TARGET_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>

              <select
                value={effectiveOp}
                onChange={(e) => update(i, { operator: e.target.value as AssertionOperator })}
                className="h-6 px-1 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 w-20 flex-shrink-0"
              >
                {ops.map((op) => (
                  <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                ))}
              </select>

              <div className="flex-1" />

              <button
                onClick={() => handleCopySnippet(i)}
                className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-accent"
                title="Copy as pm.* snippet"
              >
                {copiedIdx === i ? <Check size={10} className="text-success" /> : <Code size={10} />}
              </button>

              <button
                onClick={() => remove(i)}
                className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-error"
              >
                <X size={10} />
              </button>
            </div>

            {/* Row 2: value inputs */}
            {needsPath(a.target) && (
              <input
                value={a.path ?? ''}
                onChange={(e) => update(i, { path: e.target.value })}
                placeholder={a.target === 'xmlPath' ? '//element' : '$.data.items'}
                className="h-6 px-1.5 text-[10px] font-mono bg-surface-2 border border-border-1 rounded text-text-1 outline-none placeholder:text-text-4"
              />
            )}

            {needsHeaderName(a.target) && (
              <input
                value={a.headerName ?? ''}
                onChange={(e) => update(i, { headerName: e.target.value })}
                placeholder="Header name (e.g. Content-Type)"
                className="h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 outline-none placeholder:text-text-4"
              />
            )}

            {needsExpected(effectiveOp) && (
              <input
                value={a.expected ?? ''}
                onChange={(e) => update(i, { expected: e.target.value })}
                placeholder={a.target === 'responseTime' ? '2000' : a.target === 'arrayLength' ? '3' : 'expected value'}
                className="h-6 px-1.5 text-[10px] font-mono bg-surface-2 border border-border-1 rounded text-text-1 outline-none placeholder:text-text-4"
              />
            )}

            {needsType(effectiveOp) && (
              <select
                value={a.type ?? 'string'}
                onChange={(e) => update(i, { type: e.target.value as RequestAssertion['type'] })}
                className="h-6 px-1 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            )}
          </div>
        )
      })}

      <button
        onClick={add}
        className="flex items-center gap-1 text-[10px] text-text-4 hover:text-accent self-start py-1"
      >
        <Plus size={10} /> Add assertion
      </button>
    </div>
  )
}
