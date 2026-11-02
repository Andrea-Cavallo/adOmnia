import { useEffect, useMemo, useState } from 'react'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDETestRun } from '@/lib/code-studio-tests-api'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { clearFlakyHistory, flakyRecords, loadFlakyHistory, saveFlakyHistory, type CodeStudioFlakyHistoryEntry, type CodeStudioFlakyRecord } from './codeStudioFlakyHistory'
import { clearBenchmarkHistory, loadBenchmarkCompareSettings, loadBenchmarkHistory, saveBenchmarkCompareSettings, saveBenchmarkHistory, type CodeStudioBenchmarkCompareSettings, type CodeStudioBenchmarkHistoryEntry } from './codeStudioBenchmarkHistory'
import type { BenchmarkContext } from './CodeStudioTestParts'

export interface TestHistories {
  /** Test visti instabili in run ripetute precedenti, per "was flaky". */
  records: Map<string, CodeStudioFlakyRecord>
  flakyHistory: CodeStudioFlakyHistoryEntry[]
  benchmarkHistory: CodeStudioBenchmarkHistoryEntry[]
  benchmarkContext: BenchmarkContext
  clearFlaky: () => void
  clearBenchmarks: () => void
}

/** Storico locale dei test instabili e dei benchmark: si aggiorna a ogni nuova run, vive nel browser del progetto. */
export function useTestHistories(session: GoIDESession, runs: GoIDETestRun[]): TestHistories {
  const sessionId = session.id
  const root = session.project.rootPath
  const vcs = useCodeStudioVCSStore((state) => state.status[sessionId] ?? null)
  const [benchmarkHistory, setBenchmarkHistory] = useState<CodeStudioBenchmarkHistoryEntry[]>([])
  const [benchmarkSettings, setBenchmarkSettings] = useState<CodeStudioBenchmarkCompareSettings>(() => loadBenchmarkCompareSettings(root))
  const [flakyHistory, setFlakyHistory] = useState<CodeStudioFlakyHistoryEntry[]>([])
  const records = useMemo(() => flakyRecords(flakyHistory), [flakyHistory])
  useEffect(() => { if (!vcs) void useCodeStudioVCSStore.getState().refreshStatus(sessionId) }, [sessionId, vcs])
  useEffect(() => {
    setBenchmarkHistory(loadBenchmarkHistory(root))
    setBenchmarkSettings(loadBenchmarkCompareSettings(root))
    setFlakyHistory(loadFlakyHistory(root))
  }, [root])
  // Entrambi gli storici leggono solo le run concluse: una run in corso cambia `runs` a ogni aggiornamento
  // (4 volte al secondo) e rileggere/riscrivere localStorage a ogni tick bloccava la UI durante i test.
  const finishedKey = runs.filter((run) => run.status !== 'running').map((run) => run.runId).join('\n')
  useEffect(() => {
    if (!finishedKey) return
    const git = vcs?.available ? { branch: vcs.branch, commit: vcs.head, dirty: vcs.changes.length > 0 } : null
    setBenchmarkHistory(saveBenchmarkHistory(root, runs, git))
    setFlakyHistory(saveFlakyHistory(root, runs))
    // ponytail: vcs e runs volutamente fuori dalle dipendenze: si salva solo quando cambia l'insieme delle run concluse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedKey, root])
  const benchmarkContext = useMemo<BenchmarkContext>(() => ({
    history: benchmarkHistory,
    branch: vcs?.available ? vcs.branch : undefined,
    settings: benchmarkSettings,
    onSettingsChange: (next) => { setBenchmarkSettings(next); saveBenchmarkCompareSettings(root, next) },
  }), [benchmarkHistory, benchmarkSettings, root, vcs])
  return {
    records, flakyHistory, benchmarkHistory, benchmarkContext,
    clearFlaky: () => { clearFlakyHistory(root); setFlakyHistory([]) },
    clearBenchmarks: () => { clearBenchmarkHistory(root); setBenchmarkHistory([]) },
  }
}
