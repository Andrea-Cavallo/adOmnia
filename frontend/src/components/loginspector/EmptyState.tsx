import { useState } from 'react'
import { FileJson, Lock, Play } from 'lucide-react'
import { FileDropZone } from '@/components/utils/FileDropZone'
import { ACCEPTED_EXTENSIONS, COMMON_EXTENSIONS, LOG_SAMPLES } from '@/lib/loginspector'

// Ctrl+V lives next to the Analyze button instead of in this bar.
const SHORTCUTS: [string, string][] = [
  ['ctrl f', 'search'],
  ['ctrl shift f', 'toggle filters'],
  ['ctrl l', 'clear'],
  ['ctrl e', 'export'],
  ['esc', 'close details'],
]

/** One or two words per card; the sentence stays on the line below. */
const SAMPLE_TITLES: Record<string, string> = {
  'single-json': 'json',
  jsonl: 'ndjson',
  'java-stack': 'java trace',
  'go-panic': 'go panic',
  openshift: 'openshift',
}

// The toolbar sits at px-3; the empty state matches it so nothing shifts
// horizontally when the first import lands.
const GUTTER = 'px-3'

interface EmptyStateProps {
  onSampleId: (id: string) => void
  onFile: (file: File) => void
  onAnalyzeText: (text: string) => void
  error: string
}

export function EmptyState({ onSampleId, onFile, onAnalyzeText, error }: EmptyStateProps) {
  const [draft, setDraft] = useState('')

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-0">
      <div className={`flex min-h-full flex-col gap-4 py-4 ${GUTTER}`}>
        <Header />

        {error && (
          <p className="rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
        )}

        <InputArea
          draft={draft}
          onDraftChange={setDraft}
          onFile={onFile}
          onAnalyzeText={onAnalyzeText}
        />

        <SampleGrid onSampleId={onSampleId} />

        <ShortcutBar />
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border-1 pb-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-text-1">Inspect application logs</h2>
        <p className="mt-1 max-w-3xl text-xs text-text-3">
          Paste what a pod prints — compressed JSON, JSON Lines, plain text or a mix with stack traces —
          and read it as events instead of walls of text.
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-4">
        <Lock size={11} aria-hidden="true" />
        local only
      </span>
    </header>
  )
}

interface InputAreaProps {
  draft: string
  onDraftChange: (value: string) => void
  onFile: (file: File) => void
  onAnalyzeText: (text: string) => void
}

function InputArea({ draft, onDraftChange, onFile, onAnalyzeText }: InputAreaProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[1.15fr_1fr]">
      <FileDropZone
        accept={ACCEPTED_EXTENSIONS}
        label="Drop any log file here"
        detail={`${COMMON_EXTENSIONS} or no extension at all — the format is detected from the content`}
        onFile={onFile}
        className="h-full min-h-[200px] border-accent/45 hover:border-accent"
      />

      <div className="flex min-h-[200px] flex-col gap-2">
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text')
            if (text.length > 2000) {
              event.preventDefault()
              onAnalyzeText(text)
            }
          }}
          placeholder="...or paste / type log lines here"
          aria-label="Log text to analyze"
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded border border-border-2 bg-surface-1 p-2 font-mono text-[11px] leading-[1.5] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
        />
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] text-text-4">
            <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">ctrl v</kbd>
            paste and analyze
          </span>
          <button
            onClick={() => onAnalyzeText(draft)}
            disabled={!draft.trim()}
            className="ml-auto flex h-8 items-center gap-2 rounded border border-border-2 bg-surface-1 px-4 text-xs text-text-2 hover:border-accent/40 hover:text-text-1 disabled:opacity-40"
          >
            <Play size={13} aria-hidden="true" />
            Analyze
          </button>
        </div>
      </div>
    </div>
  )
}

function SampleGrid({ onSampleId }: { onSampleId: (id: string) => void }) {
  return (
    <section>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Try a sample</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {LOG_SAMPLES.map((sample) => (
          <button
            key={sample.id}
            onClick={() => onSampleId(sample.id)}
            title={sample.label}
            className="flex h-full flex-col gap-1 rounded border border-border-1 bg-surface-1 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-surface-2"
          >
            <span className="flex items-center gap-1.5 font-mono text-xs text-text-1">
              <FileJson size={12} className="shrink-0 text-accent-light" aria-hidden="true" />
              {SAMPLE_TITLES[sample.id] ?? sample.label}
            </span>
            <span className="text-[10px] leading-[1.45] text-text-4">{sample.detail}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function ShortcutBar() {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border-1 pt-3 text-[10px] text-text-4">
      {SHORTCUTS.map(([keys, label]) => (
        <span key={keys} className="flex items-center gap-1.5">
          <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">{keys}</kbd>
          {label}
        </span>
      ))}
    </div>
  )
}
