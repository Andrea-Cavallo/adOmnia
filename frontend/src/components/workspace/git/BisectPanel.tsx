import { useState } from 'react'
import { Bug, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { bisectMark, bisectReset, bisectRun, startBisect } from '@/lib/git/gitService'

interface BisectPanelProps {
  repoPath: string
  /** Pre-fill the known-bad commit (the right-clicked commit). */
  initialBad: string
  onClose: () => void
  onRefresh: () => void
}

function firstBad(output: string): string {
  const line = output.split('\n').find((l) => l.includes('is the first bad commit'))
  return line ? line.split(' ')[0] : ''
}

/** Visual git bisect flow: define good/bad, mark each step or automate with a
 *  test command, and surface the culprit commit. */
export function BisectPanel({ repoPath, initialBad, onClose, onRefresh }: BisectPanelProps) {
  const [good, setGood] = useState('')
  const [bad, setBad] = useState(initialBad)
  const [testCmd, setTestCmd] = useState('')
  const [started, setStarted] = useState(false)
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const culprit = firstBad(output)

  const run = async (fn: () => Promise<{ success: boolean; stdout: string; stderr: string; error: string }>, after?: () => void) => {
    setBusy(true)
    setError('')
    try {
      const res = await fn()
      setOutput((prev) => [res.stdout, res.stderr].filter(Boolean).join('\n') || prev)
      if (!res.success && res.error) setError(res.error)
      after?.()
      onRefresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-6" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[520px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3">
          <Bug size={15} className="text-accent" />
          <div className="text-sm font-semibold text-text-1">Git bisect</div>
        </div>

        {error && <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">{error}</div>}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {!started ? (
            <>
              <Field label="Known bad commit"><input value={bad} onChange={(e) => setBad(e.target.value)} placeholder="commit-ish (bad)" className="h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent" /></Field>
              <Field label="Known good commit"><input value={good} onChange={(e) => setGood(e.target.value)} placeholder="commit-ish (good)" className="h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent" /></Field>
            </>
          ) : (
            <>
              {culprit ? (
                <div className="rounded border border-error/40 bg-error/10 p-3 text-xs">
                  <div className="font-semibold text-error">First bad commit found</div>
                  <code className="mt-1 block font-mono text-text-1">{culprit}</code>
                </div>
              ) : (
                <div className="rounded border border-border-1 bg-surface-0 p-2 text-[11px] text-text-3">Test the current revision, then mark it good or bad.</div>
              )}
              <Field label="Automated test command">
                <div className="flex gap-2">
                  <input value={testCmd} onChange={(e) => setTestCmd(e.target.value)} placeholder="go test ./..." className="h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent" />
                  <button disabled={busy || !testCmd.trim()} onClick={() => void run(() => bisectRun(repoPath, testCmd))} className="h-8 shrink-0 rounded bg-accent px-3 text-xs font-medium text-white disabled:opacity-40">Run</button>
                </div>
              </Field>
              {output && <pre className="max-h-44 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px] text-text-3">{output}</pre>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button onClick={onClose} className="h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-3 hover:text-text-1">Close</button>
          {started && (
            <>
              <button disabled={busy} onClick={() => void run(() => bisectReset(repoPath), onClose)} className="h-7 rounded border border-error/40 px-3 text-xs text-error hover:bg-error/10 disabled:opacity-40">Abort</button>
              <button disabled={busy} onClick={() => void run(() => bisectMark(repoPath, 'skip'))} className="h-7 rounded border border-border-2 px-3 text-xs text-text-2 hover:bg-surface-2 disabled:opacity-40">Skip</button>
              <button disabled={busy} onClick={() => void run(() => bisectMark(repoPath, 'good'))} className="flex h-7 items-center gap-1 rounded border border-success/40 px-3 text-xs text-success hover:bg-success/10 disabled:opacity-40"><ThumbsUp size={12} /> Good</button>
              <button disabled={busy} onClick={() => void run(() => bisectMark(repoPath, 'bad'))} className="flex h-7 items-center gap-1 rounded border border-error/40 px-3 text-xs text-error hover:bg-error/10 disabled:opacity-40"><ThumbsDown size={12} /> Bad</button>
            </>
          )}
          {!started && (
            <button disabled={busy || !good.trim() || !bad.trim()} onClick={() => void run(() => startBisect(repoPath, bad, good), () => setStarted(true))} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white disabled:opacity-40">
              {busy && <Loader2 size={12} className="animate-spin" />} Start bisect
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">{label}</div>
      {children}
    </label>
  )
}
