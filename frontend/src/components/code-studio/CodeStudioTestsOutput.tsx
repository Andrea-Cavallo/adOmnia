import { useEffect, useState } from 'react'
import { getGoIDETestOutput, type GoIDETestRun } from '@/lib/code-studio-tests-api'
import { OutputLine } from './CodeStudioTestParts'

const MAX_PACKAGES = 30

export interface RunOutput {
  text: string
  loading: boolean
}

/** Output di un'intera run: la diagnostica del comando e l'output di ogni package, in ordine, con un'intestazione per package. */
export function useRunOutput(run: GoIDETestRun | null): RunOutput {
  const [state, setState] = useState<RunOutput>({ text: '', loading: false })
  // Si rilegge quando la run cambia o avanza (nuovi risultati), non a ogni render.
  const signature = run ? `${run.runId}|${run.status}|${run.summary.passed}|${run.summary.failed}|${run.summary.skipped}` : ''
  useEffect(() => {
    if (!run) { setState({ text: '', loading: false }); return }
    let cancelled = false
    setState((current) => ({ ...current, loading: true }))
    const packages = run.results.filter((result) => !result.name).slice(0, MAX_PACKAGES)
    void Promise.all(packages.map((result) => getGoIDETestOutput(run.runId, result.id).then((text) => ({ result, text })).catch(() => ({ result, text: '' })))).then((parts) => {
      if (cancelled) return
      const body = parts.filter((part) => part.text.trim()).map((part) => `── ${part.result.package} ──\n${part.text.trimEnd()}`).join('\n\n')
      setState({ text: [run.diagnostics?.trim(), body].filter(Boolean).join('\n\n'), loading: false })
    })
    return () => { cancelled = true }
    // run entra solo attraverso la firma: il resto dello snapshot cambia a ogni evento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  return state
}

/** Colore semantico di una riga di `go test`/Surefire: esito e fallimenti si leggono senza cercare. */
function lineTone(line: string): string {
  if (/^\s*(--- FAIL|FAIL\b|panic:|\[ERROR\]|✗)/.test(line)) return 'text-danger'
  if (/^\s*(--- PASS|ok\b|PASS\b|\[INFO\] BUILD SUCCESS)/.test(line)) return 'text-success'
  if (/^\s*(=== RUN|──)/.test(line)) return 'text-text-3'
  return 'text-text-2'
}

export function OutputLines({ text, baseDirectory, tail }: { text: string; baseDirectory: string; tail?: number }) {
  const lines = text.split('\n')
  const shown = tail ? lines.slice(-tail) : lines
  return (
    <>
      {shown.map((line, index) => <div key={index} className={lineTone(line)}><OutputLine line={line} baseDirectory={baseDirectory} /></div>)}
    </>
  )
}
