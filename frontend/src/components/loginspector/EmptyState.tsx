import { useState } from 'react'
import { ClipboardPaste, FileJson, Play, Terminal } from 'lucide-react'
import { FileDropZone } from '@/components/utils/FileDropZone'
import { ACCEPTED_EXTENSIONS, COMMON_EXTENSIONS, LOG_SAMPLES, OC_LOGS_SOURCE } from '@/lib/loginspector'

const SHORTCUTS: [string, string][] = [
  ['Ctrl V', 'Paste and analyze'],
  ['Ctrl F', 'Search'],
  ['Ctrl Shift F', 'Toggle filters'],
  ['Ctrl L', 'Clear'],
  ['Ctrl E', 'Export'],
  ['Esc', 'Close details'],
]

interface EmptyStateProps {
  onSampleId: (id: string) => void
  onFile: (file: File) => void
  onPasteFromClipboard: () => void
  onAnalyzeText: (text: string) => void
  error: string
}

export function EmptyState({ onSampleId, onFile, onPasteFromClipboard, onAnalyzeText, error }: EmptyStateProps) {
  const [draft, setDraft] = useState('')

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-0">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-6">
        <div>
          <h2 className="text-base font-semibold text-text-1">Inspect application logs</h2>
          <p className="mt-1 max-w-2xl text-xs text-text-3">
            Paste what a pod prints — compressed JSON, JSON Lines, plain text or a mix with stack traces —
            and read it as events instead of walls of text. Everything stays on this machine.
          </p>
        </div>

        {error && (
          <p className="rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <button
              onClick={onPasteFromClipboard}
              className="flex h-9 items-center justify-center gap-2 rounded-md border border-accent/40 bg-accent/15 text-xs font-semibold text-accent-light hover:bg-accent/25"
            >
              <ClipboardPaste size={14} /> Paste from clipboard and analyze
            </button>
            <FileDropZone
              accept={ACCEPTED_EXTENSIONS}
              label="Drop any log file here"
              detail={`${COMMON_EXTENSIONS} or no extension at all — the format is detected from the content`}
              onFile={onFile}
            />
            <div
              title={OC_LOGS_SOURCE.reason}
              className="flex cursor-not-allowed items-center gap-2 rounded border border-dashed border-border-2 px-3 py-2 text-[11px] text-text-4"
            >
              <Terminal size={13} />
              <span className="min-w-0 flex-1">
                <span className="font-mono">oc logs</span> streaming — planned, not implemented yet
              </span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">soon</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData('text')
                if (text.length > 2000) {
                  event.preventDefault()
                  onAnalyzeText(text)
                }
              }}
              placeholder="...or paste / type log lines here"
              spellCheck={false}
              className="min-h-[168px] flex-1 resize-none rounded-md border border-border-2 bg-surface-1 p-2 font-mono text-[11px] leading-[1.5] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
            />
            <button
              onClick={() => onAnalyzeText(draft)}
              disabled={!draft.trim()}
              className="flex h-8 items-center justify-center gap-2 rounded-md border border-border-2 bg-surface-1 text-xs text-text-2 hover:border-accent/40 hover:text-text-1 disabled:opacity-40"
            >
              <Play size={13} /> Analyze
            </button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Try a sample</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {LOG_SAMPLES.map((sample) => (
              <button
                key={sample.id}
                onClick={() => onSampleId(sample.id)}
                className="flex flex-col gap-1 rounded-md border border-border-1 bg-surface-1 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-surface-2"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-text-1">
                  <FileJson size={12} className="text-accent-light" />
                  {sample.label}
                </span>
                <span className="text-[10px] text-text-4">{sample.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Shortcuts</p>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-text-4 sm:grid-cols-[auto_1fr_auto_1fr]">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="contents">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">{keys}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
