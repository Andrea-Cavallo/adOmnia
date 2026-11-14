/**
 * Generate a diagram from text: Markdown (read by the backend, the same parser the MCP server uses)
 * into a new laid-out diagram, or Mermaid-style sequence text into a new page of the open diagram.
 */
import { useRef, useState } from 'react'
import { DiagramFromMarkdown } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/app'
import type { BlueprintFile } from '@/lib/diagrams/importFile'
import { useDiagramStudio } from '@/stores/diagramStudio'

export type GenerateMode = 'markdown' | 'sequence'

const SAMPLES: Record<GenerateMode, string> = {
  markdown: `# Order platform

## Edge
- **Web app** (React)
- API Gateway

## Backend
- Order Service (Go)
- Payment Service (Java)
- Orders DB (Postgres)
- orders topic (Kafka)

Web app -> API Gateway: HTTPS
API Gateway => Order Service
Order Service -> Orders DB: insert
Order Service --> orders topic: OrderPlaced
orders topic -> Payment Service: consume

## Checkout
1. Open cart
2. Is the card valid?
3. Confirm order
`,
  sequence: `sequenceDiagram
autonumber
actor User
participant API as Order API
participant DB as Orders DB
User->>API: POST /orders
API->>DB: insert order
DB-->>API: id
alt stock available
  API-->>User: 201 Created
else out of stock
  API-->>User: 409 Conflict
end`,
}

const TEXTS: Record<GenerateMode, { title: string; help: string; action: string }> = {
  markdown: {
    title: 'New diagram from Markdown',
    help: '# is the title, ## sections with bullet lists become groups of components, numbered lists become step flows, A -> B: label becomes a connector (--> dashed, => animated). Mermaid flowchart and sequenceDiagram blocks work too.',
    action: 'Generate diagram',
  },
  sequence: {
    title: 'Sequence diagram from text',
    help: 'participant / actor, A->>B: call (sync), A-)B: event (async), A-->>B: reply, loop / alt / else / opt … end, autonumber. It is added as a new page; every element stays editable.',
    action: 'Add sequence page',
  },
}

export function GenerateDialog({ mode, onClose }: { mode: GenerateMode; onClose: () => void }) {
  const [text, setText] = useState(SAMPLES[mode])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const copy = TEXTS[mode]

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      if (mode === 'sequence') {
        useDiagramStudio.getState().addSequencePage(text)
      } else {
        const blueprint = await DiagramFromMarkdown(text)
        await useDiagramStudio.getState().createFromBlueprint(blueprint as unknown as BlueprintFile)
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="diagram-dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="diagram-dialog" role="dialog" aria-modal="true" aria-label={copy.title} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
        <h2>{copy.title}</h2>
        <p>{copy.help}</p>
        <textarea className="diagram-input" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} autoFocus aria-label="Source text" />
        {error && <p role="alert" style={{ color: 'var(--color-error)' }}>{error}</p>}
        <div className="diagram-dialog-actions">
          {mode === 'markdown' && (
            <>
              <button type="button" onClick={() => fileInput.current?.click()}>Open .md file…</button>
              <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown" hidden onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void file.text().then(setText)
              }} />
            </>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="is-primary" disabled={busy || !text.trim()} onClick={() => void run()}>{busy ? 'Working…' : copy.action}</button>
        </div>
      </div>
    </div>
  )
}
