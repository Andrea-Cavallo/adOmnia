import type {
  VisualTest,
  TestBlock,
  BlockResult,
  VisualTestResult,
  RequestBlock,
  AssertBlock,
  SetVarBlock,
  RequestItem,
  ResponseData,
} from '@/lib/types'
import { executeRequest } from '@/lib/executeRequest'
import { useCollectionsStore } from '@/stores/collections'

type OnBlockUpdate = (blockId: string, state: BlockResult) => void

interface LastResponse {
  body: string
  status: number
  headers: Record<string, string>
}

function flattenRequests(children: unknown[]): RequestItem[] {
  const result: RequestItem[] = []
  for (const child of children) {
    const c = child as { type?: string; children?: unknown[] } & RequestItem
    if (c.type === 'request' || !c.children) result.push(c)
    else if (c.children) result.push(...flattenRequests(c.children))
  }
  return result
}

function lowercaseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = v
  return out
}

function extractJsonPath(body: string, path: string): string {
  try {
    let obj: unknown = JSON.parse(body)
    const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean)
    for (const part of parts) {
      if (obj === null || typeof obj !== 'object') return ''
      obj = (obj as Record<string, unknown>)[part]
    }
    return obj === undefined || obj === null ? '' : String(obj)
  } catch {
    return ''
  }
}

interface RunBlockOutcome {
  passed: boolean
  message: string
  response?: LastResponse
}

async function runBlock(
  block: TestBlock,
  vars: Record<string, string>,
  lastResponse: LastResponse | null,
  onUpdate: OnBlockUpdate,
  allRequests: RequestItem[],
): Promise<RunBlockOutcome> {
  const start = Date.now()
  onUpdate(block.id, { blockId: block.id, state: 'running', message: '', durationMs: 0 })

  try {
    if (block.type === 'request') {
      const rb = block as RequestBlock
      const reqItem = allRequests.find((r) => r.id === rb.collectionItemId)
      if (!reqItem) {
        const message = `Request item not found: ${rb.collectionItemId || '(none selected)'}`
        onUpdate(block.id, { blockId: block.id, state: 'failed', message, durationMs: Date.now() - start })
        return { passed: false, message }
      }

      const result = await executeRequest(reqItem, { ...vars })
      const response: ResponseData = result.response

      for (const extract of rb.extractVars ?? []) {
        if (extract.varName && extract.jsonPath) {
          vars[extract.varName] = extractJsonPath(response.body ?? '', extract.jsonPath)
        }
      }

      const failed = !!response.error || response.status === 0
      const message = response.error
        ? response.error.message
        : `${response.status} ${response.statusText}`.trim()
      onUpdate(block.id, {
        blockId: block.id,
        state: failed ? 'failed' : 'passed',
        message,
        durationMs: Date.now() - start,
      })
      return {
        passed: !failed,
        message,
        response: { body: response.body ?? '', status: response.status, headers: lowercaseHeaders(response.headers) },
      }
    }

    if (block.type === 'assert') {
      const ab = block as AssertBlock
      if (!lastResponse) {
        const message = 'No previous response to assert against'
        onUpdate(block.id, { blockId: block.id, state: 'failed', message, durationMs: Date.now() - start })
        return { passed: false, message }
      }
      let actual = ''
      if (ab.source === 'status') actual = String(lastResponse.status)
      else if (ab.source === 'header') actual = lastResponse.headers[ab.field.toLowerCase()] ?? ''
      else actual = extractJsonPath(lastResponse.body, ab.field)

      let passed = false
      switch (ab.operator) {
        case 'eq': passed = actual === ab.expected; break
        case 'neq': passed = actual !== ab.expected; break
        case 'contains': passed = actual.includes(ab.expected); break
        case 'gt': passed = parseFloat(actual) > parseFloat(ab.expected); break
        case 'lt': passed = parseFloat(actual) < parseFloat(ab.expected); break
        case 'exists': passed = actual !== ''; break
      }
      const message = passed
        ? `${actual} ${ab.operator} ${ab.expected}`
        : `Expected ${ab.field} ${ab.operator} "${ab.expected}", got "${actual}"`
      onUpdate(block.id, { blockId: block.id, state: passed ? 'passed' : 'failed', message, durationMs: Date.now() - start })
      return { passed, message }
    }

    if (block.type === 'setvar') {
      const sv = block as SetVarBlock
      // Resolve ${var} references against the running variable map.
      const value = sv.expression.replace(/\$\{(\w+)\}/g, (_, name) => vars[name] ?? '')
      vars[sv.varName] = value
      onUpdate(block.id, { blockId: block.id, state: 'passed', message: `${sv.varName} = ${value}`, durationMs: Date.now() - start })
      return { passed: true, message: 'ok' }
    }

    // if / loop are not yet supported in the v1 runner.
    onUpdate(block.id, { blockId: block.id, state: 'skipped', message: 'block type not yet supported', durationMs: Date.now() - start })
    return { passed: true, message: 'skipped' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    onUpdate(block.id, { blockId: block.id, state: 'failed', message, durationMs: Date.now() - start })
    return { passed: false, message }
  }
}

export async function runVisualTest(test: VisualTest, onBlockUpdate: OnBlockUpdate): Promise<VisualTestResult> {
  const collections = useCollectionsStore.getState().collections
  const allRequests = collections.flatMap((c) => flattenRequests(c.children ?? []))
  const vars: Record<string, string> = {}
  const blockResults: BlockResult[] = []
  let allPassed = true
  const start = Date.now()
  let lastResponse: LastResponse | null = null

  for (const block of test.blocks) {
    const outcome = await runBlock(
      block,
      vars,
      lastResponse,
      (id, result) => {
        blockResults.push(result)
        onBlockUpdate(id, result)
      },
      allRequests,
    )
    if (outcome.response) lastResponse = outcome.response
    if (!outcome.passed) {
      allPassed = false
      break
    }
  }

  return { testId: test.id, blockResults, passed: allPassed, durationMs: Date.now() - start }
}
