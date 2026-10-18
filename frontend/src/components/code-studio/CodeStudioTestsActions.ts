import { useMemo } from 'react'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDETestRunRequest } from '@/lib/code-studio-tests-api'
import { debugRequestForNode, isFailed, rerunFailedRequest } from '@/lib/code-studio/codeStudioTestTree'
import type { TestSuite } from '@/lib/code-studio/testSuites'
import type { TestTarget } from '@/lib/code-studio/testTargets'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { useCodeStudioTestsStore, type QueuedTestRun } from '@/stores/codeStudioTests'

export const REPEAT_OPTIONS = [10, 20, 50, 100]

/** Richiesta di "tutti i test" di un target; i progetti senza unità rilevate usano `./...` dalla radice. */
export function requestForTarget(sessionId: string, target: TestTarget, extra: Partial<GoIDETestRunRequest> = {}): GoIDETestRunRequest {
  return { sessionId, language: target.language, workingDirectory: target.workingDirectory, packages: target.packages, ...extra } as GoIDETestRunRequest
}

export interface TestActions {
  runSuite: (suite: TestSuite, extra?: Partial<GoIDETestRunRequest>) => void
  runAll: (suites: readonly TestSuite[], extra?: Partial<GoIDETestRunRequest>) => void
  rerunFailed: (suites: readonly TestSuite[]) => void
  /** Debug del primo test fallito della suite: Delve sa avviare un singolo test, non un'intera suite. */
  debugSuite: (suite: TestSuite) => void
  canDebug: (suite: TestSuite) => boolean
  stop: () => void
}

/** Azioni della dashboard Tests: tutte passano dallo store, che serializza le suite in coda. */
export function useTestActions(session: GoIDESession): TestActions {
  const sessionId = session.id
  return useMemo<TestActions>(() => {
    const store = () => useCodeStudioTestsStore.getState()
    const queueOf = (suites: readonly TestSuite[], extra?: Partial<GoIDETestRunRequest>): QueuedTestRun[] => suites.map((suite) => ({ key: suite.key, request: requestForTarget(sessionId, suite.target, extra) }))
    const firstFailed = (suite: TestSuite) => suite.run?.results.find((result) => result.name && isFailed(result)) ?? null
    return {
      runSuite: (suite, extra) => void store().start(requestForTarget(sessionId, suite.target, extra)),
      runAll: (suites, extra) => void store().runAll(sessionId, queueOf(suites, extra)),
      rerunFailed: (suites) => {
        const items = suites.flatMap((suite) => {
          const request = suite.run && suite.status === 'failed' ? rerunFailedRequest(suite.run) : null
          return request ? [{ key: suite.key, request }] : []
        })
        if (items.length) void store().runAll(sessionId, items)
      },
      debugSuite: (suite) => {
        const failed = firstFailed(suite)
        const request = suite.run && failed ? debugRequestForNode(suite.run, failed) : null
        if (request) void useCodeStudioDebugStore.getState().start(request)
      },
      canDebug: (suite) => suite.language === 'go' && firstFailed(suite) !== null,
      stop: () => {
        store().clearQueue(sessionId)
        const running = (store().runs[sessionId] ?? []).find((run) => run.status === 'running')
        if (running) void useCodeStudioStore.getState().stopRun(running.runId)
      },
    }
  }, [sessionId])
}
