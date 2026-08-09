import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiDocContent, ApiDocOperation, ApiDocParam, ApiDocSchema } from '@/lib/apidocs/parseSpec'
import { SchemaView } from './SchemaView'
import { InlineMarkdown, MiniMarkdown } from './MiniMarkdown'

// Method accent colors (badge + border). Tuned to read on the dark surface.
const METHOD_COLOR: Record<string, string> = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  PATCH: '#50e3c2',
  DELETE: '#f93e3e',
  HEAD: '#9012fe',
  OPTIONS: '#0d9de3',
  QUERY: '#c084fc',
  TRACE: '#8b95a5',
}

interface OperationCardProps {
  operation: ApiDocOperation
  registry: Record<string, ApiDocSchema>
  defaultOpen?: boolean
  onTryOperation?: (operation: ApiDocOperation) => void
}

export function OperationCard({ operation, registry, defaultOpen = false, onTryOperation }: OperationCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const color = METHOD_COLOR[operation.method] ?? METHOD_COLOR.GET

  return (
    <div
      data-oas-operation={`${operation.method} ${operation.path}`}
      className="overflow-hidden rounded-md border bg-surface-1"
      style={{ borderColor: `${color}55` }}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2"
        style={{ backgroundColor: `${color}14` }}
      >
        <span
          className="w-16 shrink-0 rounded px-2 py-1 text-center text-[11px] font-bold leading-none text-black"
          style={{ backgroundColor: color }}
        >
          {operation.method}
        </span>
        <span className="min-w-0 shrink-0 font-mono text-[13px] font-semibold text-text-1">{operation.path}</span>
        {operation.summary && <span className="min-w-0 flex-1 truncate text-[12px] text-text-3">{operation.summary}</span>}
        {operation.deprecated && (
          <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">deprecated</span>
        )}
        <ChevronRight size={16} className={cn('ml-auto shrink-0 text-text-4 transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="border-t text-text-2" style={{ borderColor: `${color}33` }}>
          {(operation.description || operation.summary) && (
            <div className="border-b border-border-1 px-4 py-3">
              <MiniMarkdown text={operation.description || operation.summary || ''} className="text-[12px] leading-relaxed text-text-3" />
            </div>
          )}

          <ParametersSection
            parameters={operation.parameters}
            registry={registry}
            onTryOperation={onTryOperation ? () => onTryOperation(operation) : undefined}
          />

          {operation.requestBody && (
            <section className="border-t border-border-1">
              <div className="flex min-h-10 items-center gap-3 px-4 py-2">
                <SectionTitle>
                  Request body
                  {operation.requestBody.required && <span className="ml-1.5 align-middle text-[10px] font-bold text-error">required</span>}
                </SectionTitle>
              </div>
              <div className="border-t border-border-1 px-4 py-3">
                {operation.requestBody.description && (
                  <div className="mb-2 text-[12px] text-text-3"><InlineMarkdown text={operation.requestBody.description} /></div>
                )}
                <ContentBlock contents={operation.requestBody.contents} registry={registry} />
              </div>
            </section>
          )}

          <section className="border-t border-border-1 px-4 py-3">
            <SectionTitle>Responses</SectionTitle>
            <div className="mt-3 overflow-hidden rounded border border-border-1">
              <div className="grid grid-cols-[80px_minmax(0,1fr)] border-b border-border-1 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-text-3">
                <span>Code</span>
                <span>Description</span>
              </div>
              {operation.responses.map((response) => (
                <div key={response.status} className="grid grid-cols-[80px_minmax(0,1fr)] border-b border-border-1 px-3 py-2.5 last:border-b-0">
                  <div>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', statusClass(response.status))}>{response.status}</span>
                  </div>
                  <div className="min-w-0">
                    {response.description && <div className="mb-2 text-[12px] text-text-3"><InlineMarkdown text={response.description} /></div>}
                    <ContentBlock contents={response.contents} registry={registry} compact />
                  </div>
                </div>
              ))}
              {operation.responses.length === 0 && <p className="px-3 py-3 text-[12px] text-text-4">No responses documented.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function ContentBlock({
  contents,
  registry,
  compact,
}: {
  contents: ApiDocContent[]
  registry: Record<string, ApiDocSchema>
  compact?: boolean
}) {
  const [contentType, setContentType] = useState(contents[0]?.contentType ?? '')
  if (contents.length === 0) return null
  const active = contents.find((c) => c.contentType === contentType) ?? contents[0]

  return (
    <div className="space-y-2">
      {contents.length > 1 ? (
        <select
          value={active.contentType}
          onChange={(e) => setContentType(e.target.value)}
          className="h-7 rounded border border-border-2 bg-surface-2 px-2 font-mono text-[11px] text-text-2 outline-none focus:border-accent"
          title="Media type"
        >
          {contents.map((c) => (
            <option key={c.contentType} value={c.contentType}>{c.contentType}</option>
          ))}
        </select>
      ) : (
        active.contentType && (
          <span className="inline-block rounded border border-border-2 bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-3">{active.contentType}</span>
        )
      )}
      <PayloadTabs example={active.example} schema={active.schema} registry={registry} compact={compact} />
    </div>
  )
}

function PayloadTabs({
  example,
  schema,
  registry,
  compact,
}: {
  example: unknown
  schema?: ApiDocSchema
  registry: Record<string, ApiDocSchema>
  compact?: boolean
}) {
  const [tab, setTab] = useState<'example' | 'schema'>(example === undefined || example === null ? 'schema' : 'example')

  if (!schema && (example === undefined || example === null)) return null

  return (
    <div className="overflow-hidden rounded border border-border-1 bg-surface-0">
      <div className="flex h-8 items-center gap-1 border-b border-border-1 bg-surface-1 px-2">
        <button
          type="button"
          onClick={() => setTab('example')}
          disabled={example === undefined || example === null}
          className={cn(
            'h-6 rounded px-2 text-[11px] font-semibold',
            tab === 'example' ? 'bg-surface-2 text-text-1' : 'text-text-4 hover:text-text-2',
            (example === undefined || example === null) && 'cursor-not-allowed opacity-45 hover:text-text-4',
          )}
        >
          Example
        </button>
        <button
          type="button"
          onClick={() => setTab('schema')}
          className={cn(
            'h-6 rounded px-2 text-[11px] font-semibold',
            tab === 'schema' ? 'bg-surface-2 text-text-1' : 'text-text-4 hover:text-text-2',
          )}
        >
          Schema
        </button>
      </div>
      <div className={compact ? 'p-2' : 'p-3'}>
        {tab === 'example'
          ? <ExampleBlock example={example} />
          : <SchemaView schema={schema} registry={registry} />}
      </div>
    </div>
  )
}

function ParametersSection({
  parameters,
  registry,
  onTryOperation,
}: {
  parameters: ApiDocParam[]
  registry: Record<string, ApiDocSchema>
  onTryOperation?: () => void
}) {
  const order: ApiDocParam['in'][] = ['path', 'query', 'header', 'cookie']
  return (
    <section className="border-t border-border-1">
      <div className="flex min-h-10 items-center justify-between gap-3 px-4 py-2">
        <SectionTitle>Parameters</SectionTitle>
        {onTryOperation && (
          <button
            onClick={onTryOperation}
            className="h-7 rounded border border-accent/40 bg-accent/10 px-4 text-[12px] font-semibold text-accent hover:bg-accent/15"
          >
            Try it out
          </button>
        )}
      </div>
      <div className="border-t border-border-1 px-4 py-3">
        {parameters.length === 0 && <p className="text-[12px] text-text-4">No parameters</p>}
        {order.map((location) => {
          const group = parameters.filter((parameter) => parameter.in === location)
          if (group.length === 0) return null
          return (
            <div key={location} className="mb-3 last:mb-0">
              <h5 className="mb-1.5 text-[11px] font-semibold uppercase text-text-4">{location} parameters</h5>
              <div className="overflow-hidden rounded border border-border-1">
                {group.map((parameter) => (
                  <div key={`${location}_${parameter.name}`} className="grid grid-cols-[minmax(120px,0.7fr)_minmax(120px,0.8fr)_minmax(0,1.5fr)] gap-2 border-b border-border-1 px-2.5 py-2 text-[11px] last:border-b-0">
                    <div className="min-w-0">
                      <span className="block truncate font-mono font-semibold text-text-1">{parameter.name}</span>
                      {parameter.required && <span className="mt-0.5 inline-block text-[10px] font-semibold text-error">required</span>}
                    </div>
                    <div className="min-w-0">{parameter.schema && <SchemaView schema={parameter.schema} registry={registry} depth={5} />}</div>
                    <div className="min-w-0 text-text-3">{parameter.description || '-'}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// Matches JSON tokens: strings (with optional trailing key colon), literals, numbers.
const JSON_TOKEN = /"(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

// ponytail: tiny regex JSON highlighter — no dependency, renders spans (never
// innerHTML) so example payloads from the spec can't inject markup.
function highlightJson(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let key = 0
  JSON_TOKEN.lastIndex = 0
  for (let m = JSON_TOKEN.exec(text); m; m = JSON_TOKEN.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('"')) {
      const colon = m[1] ?? ''
      const quoted = tok.slice(0, tok.length - colon.length)
      // A string followed by a colon is a key; otherwise a string value.
      nodes.push(<span key={key++} className={colon ? 'text-accent' : 'text-success'}>{quoted}</span>)
      if (colon) nodes.push(<span key={key++} className="text-text-4">{colon}</span>)
    } else if (tok === 'true' || tok === 'false' || tok === 'null') {
      nodes.push(<span key={key++} className="text-[#60a5fa]">{tok}</span>)
    } else {
      nodes.push(<span key={key++} className="text-warning">{tok}</span>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function ExampleBlock({ example }: { example: unknown }) {
  if (example === undefined || example === null) return null
  const isString = typeof example === 'string'
  const text = isString ? example : JSON.stringify(example, null, 2)
  return (
    <pre className="max-h-80 overflow-auto rounded bg-surface-2 p-3 font-mono text-[11px] leading-[18px] text-text-3">
      {isString ? text : highlightJson(text)}
    </pre>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="m-0 text-[12px] font-bold uppercase tracking-wide text-text-2">
      {children}
    </h4>
  )
}

function statusClass(status: string): string {
  if (status.startsWith('2')) return 'bg-success/15 text-success'
  if (status.startsWith('3')) return 'bg-accent/15 text-accent'
  if (status.startsWith('4')) return 'bg-warning/15 text-warning'
  if (status.startsWith('5')) return 'bg-error/15 text-error'
  return 'bg-surface-2 text-text-3'
}
