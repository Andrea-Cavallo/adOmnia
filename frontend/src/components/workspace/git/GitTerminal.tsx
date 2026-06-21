import { useState } from 'react'
import { RotateCcw, Terminal } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'

interface Entry extends GitSync.TerminalResult { id: number }

export function GitTerminal({ repoPath, disabled, onRepositoryChanged }: { repoPath: string; disabled: boolean; onRepositoryChanged: () => Promise<void> }) {
  const [command, setCommand] = useState('git status --short --branch')
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    if (!command.trim() || !repoPath) return
    setBusy(true); setError('')
    try {
      const result = await GitSync.RunTerminalCommand(repoPath, command.trim())
      setEntries((current) => [...current, { ...result, id: Date.now() }])
      await onRepositoryChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  return (
    <section className="min-w-0 rounded border border-border-1 bg-surface-1 xl:col-span-2">
      <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-4"><Terminal size={13} /> Repository terminal <span className="ml-auto max-w-[60%] truncate normal-case tracking-normal" title={repoPath}>{repoPath || 'No repository selected'}</span></div>
      <div className="space-y-2 p-3">
        <div className="h-48 overflow-y-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[11px] leading-5 text-text-2">
          {entries.length === 0 && <div className="text-text-4">Commands run with the active repository as their working directory. Output stays local to this session.</div>}
          {entries.map((entry) => <div key={entry.id} className="mb-2"><div className="text-accent">PS {repoPath}&gt; {entry.command}</div><pre className="whitespace-pre-wrap break-words">{entry.output || '(no output)'}</pre>{entry.exitCode !== 0 && <div className="text-error">Process exited with code {entry.exitCode}</div>}</div>)}
        </div>
        <div className="flex gap-2"><input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run() }} className="h-8 min-w-0 flex-1 rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none focus:border-accent" placeholder="Enter a command…" /><button onClick={() => void run()} disabled={disabled || busy || !command.trim()} className="inline-flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40"><Terminal size={12} /> {busy ? 'Running…' : 'Run'}</button><button onClick={() => setEntries([])} disabled={busy || entries.length === 0} className="inline-flex h-8 items-center gap-1.5 rounded border border-border-2 px-2.5 text-xs text-text-2 disabled:opacity-40"><RotateCcw size={12} /> Clear</button></div>
        {error && <div className="rounded border border-error/40 bg-error/10 px-2 py-1.5 text-[10px] text-error">{error}</div>}
      </div>
    </section>
  )
}
