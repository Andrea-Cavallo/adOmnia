import { useState } from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiDocOperation, ApiDocParam, ApiDocSchema } from '@/lib/apidocs/parseSpec'
import { SchemaView } from './SchemaView'

const METHOD_STYLE: Record<string, { border: string; panel: string; badge: string; text: string }> = {
  GET: { border: '#61affe', panel: 'rgba(97,175,254,.1)', badge: '#61affe', text: '#0f5f9f' },
  POST: { border: '#49cc90', panel: 'rgba(73,204,144,.1)', badge: '#49cc90', text: '#17683e' },
  PUT: { border: '#fca130', panel: 'rgba(252,161,48,.1)', badge: '#fca130', text: '#8a5200' },
  PATCH: { border: '#50e3c2', panel: 'rgba(80,227,194,.1)', badge: '#50e3c2', text: '#0b6b5b' },
  DELETE: { border: '#f93e3e', panel: 'rgba(249,62,62,.1)', badge: '#f93e3e', text: '#9b1c1c' },
  HEAD: { border: '#9012fe', panel: 'rgba(144,18,254,.1)', badge: '#9012fe', text: '#5e0ba8' },
  OPTIONS: { border: '#0d5aa7', panel: 'rgba(13,90,167,.1)', badge: '#0d5aa7', text: '#0d4d8d' },
  QUERY: { border: '#0d5aa7', panel: 'rgba(13,90,167,.1)', badge: '#0d5aa7', text: '#0d4d8d' },
  TRACE: { border: '#0d5aa7', panel: 'rgba(13,90,167,.1)', badge: '#0d5aa7', text: '#0d4d8d' },
}

interface OperationCardProps {
  operation: ApiDocOperation
  registry: Record<string, ApiDocSchema>
  defaultOpen?: boolean
}

export function OperationCard({ operation, registry, defaultOpen = false }: OperationCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const methodStyle = METHOD_STYLE[operation.method] ?? METHOD_STYLE.GET

  return (
    <div
      data-oas-operation={`${operation.method} ${operation.path}`}
      className="overflow-hidden rounded border bg-white font-sans shadow-sm"
      style={{ borderColor: methodStyle.border }}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full items-center gap-2 px-2.5 py-1.5 text-left"
        style={{ backgroundColor: methodStyle.panel }}
      >
        <span
          className="w-16 shrink-0 rounded px-2 py-1 text-center text-[11px] font-bold leading-none text-white"
          style={{ backgroundColor: methodStyle.badge }}
        >
          {operation.method}
        </span>
        <span className="min-w-0 shrink-0 font-mono text-[13px] font-bold text-[#3b4151]">{operation.path}</span>
        {operation.summary && <span className="min-w-0 flex-1 truncate text-[12px] text-[#3b4151]">{operation.summary}</span>}
        {operation.deprecated && (
          <span className="shrink-0 rounded bg-[#fca130]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a5200]">deprecated</span>
        )}
        <Lock size={15} className="ml-auto shrink-0 text-[#7d8492]" />
        <ChevronRight size={17} className={cn('shrink-0 text-[#3b4151] transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="border-t bg-white text-[#3b4151]" style={{ borderColor: methodStyle.border }}>
          <div className="px-4 py-7" style={{ backgroundColor: methodStyle.panel }}>
            <p className="text-[13px] leading-relaxed text-[#3b4151]">
              {operation.description || operation.summary || 'No description provided.'}
            </p>
          </div>

          <ParametersSection parameters={operation.parameters} registry={registry} />

          {operation.requestBody && (
            <section className="border-t border-[#e6e6e6] bg-white">
              <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                <SectionTitle>
                  Request body
                  {operation.requestBody.required && <span className="ml-1 align-middle text-[10px] font-bold normal-case text-[#ff0000]">required</span>}
                </SectionTitle>
                <select
                  value={operation.requestBody.contentTypes[0] ?? 'application/json'}
                  onChange={() => {}}
                  className="h-8 min-w-56 rounded border-2 border-[#41444e] bg-white px-3 font-mono text-[12px] font-bold text-[#3b4151] outline-none"
                >
                  {operation.requestBody.contentTypes.map((contentType) => (
                    <option key={contentType} value={contentType}>{contentType}</option>
                  ))}
                </select>
              </div>
              <div className="border-t border-[#e6e6e6] px-4 py-6" style={{ backgroundColor: methodStyle.panel }}>
                <p className="mb-4 text-[13px] text-[#3b4151]">{operation.requestBody.description || operation.summary || 'Request payload'}</p>
                <PayloadTabs
                  example={operation.requestBody.example}
                  schema={operation.requestBody.schema}
                  registry={registry}
                />
              </div>
            </section>
          )}

          <section className="border-t border-[#e6e6e6] bg-white px-4 py-4">
            <SectionTitle>Responses</SectionTitle>
            <div className="mt-4 overflow-hidden rounded-sm border border-[#e6e6e6] bg-white">
              <div className="grid grid-cols-[84px_minmax(0,1fr)_64px] border-b border-[#e6e6e6] px-3 py-2 text-[12px] font-bold text-[#3b4151]">
                <span>Code</span>
                <span>Description</span>
                <span className="text-right">Links</span>
              </div>
              {operation.responses.map((response) => (
                <div key={response.status} className="grid grid-cols-[84px_minmax(0,1fr)_64px] gap-0 border-b border-[#e6e6e6] px-3 py-3 last:border-b-0">
                  <div>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', statusClass(response.status))}>{response.status}</span>
                  </div>
                  <div className="min-w-0">
                    {response.description && <p className="mb-2 text-[12px] text-[#3b4151]">{response.description}</p>}
                    <div className="mb-2 flex flex-wrap gap-1">
                      {response.contentTypes.map((contentType) => (
                        <span key={contentType} className="rounded bg-[#ebebeb] px-1.5 py-0.5 font-mono text-[10px] text-[#3b4151]">{contentType}</span>
                      ))}
                    </div>
                    <PayloadTabs
                      example={response.example}
                      schema={response.schema}
                      registry={registry}
                      compact
                    />
                  </div>
                  <div className="text-right text-[12px] text-[#7d8492]">-</div>
                </div>
              ))}
              {operation.responses.length === 0 && <p className="px-3 py-4 text-[12px] text-[#7d8492]">No responses documented.</p>}
            </div>
          </section>
        </div>
      )}
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
    <div className="overflow-hidden rounded border border-[#d8dde7] bg-white">
      <div className="flex h-8 items-center gap-1 border-b border-[#d8dde7] bg-white px-2">
        <button
          type="button"
          onClick={() => setTab('example')}
          disabled={example === undefined || example === null}
          className={cn(
            'h-6 rounded px-2 text-[11px] font-bold',
            tab === 'example' ? 'bg-[#ebebeb] text-[#3b4151]' : 'text-[#7d8492] hover:bg-[#f3f3f3] hover:text-[#3b4151]',
            (example === undefined || example === null) && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-[#7d8492]',
          )}
        >
          Example Value
        </button>
        <button
          type="button"
          onClick={() => setTab('schema')}
          className={cn(
            'h-6 rounded px-2 text-[11px] font-bold',
            tab === 'schema' ? 'bg-[#ebebeb] text-[#3b4151]' : 'text-[#7d8492] hover:bg-[#f3f3f3] hover:text-[#3b4151]',
          )}
        >
          Schema
        </button>
      </div>
      <div className={compact ? 'p-2' : 'p-3'}>
        {tab === 'example'
          ? <ExampleBlock example={example} />
          : <div className="text-[#3b4151]"><SchemaView schema={schema} registry={registry} /></div>}
      </div>
    </div>
  )
}

function ParametersSection({ parameters, registry }: { parameters: ApiDocParam[]; registry: Record<string, ApiDocSchema> }) {
  const order: ApiDocParam['in'][] = ['path', 'query', 'header', 'cookie']
  return (
    <section className="border-t border-[#e6e6e6] bg-white">
      <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
        <SectionTitle>Parameters</SectionTitle>
        <button className="h-8 rounded border-2 border-[#7d8492] bg-white px-6 text-[13px] font-bold text-[#3b4151] shadow-sm hover:bg-[#f7f7f7]">
          Try it out
        </button>
      </div>
      <div className="border-t border-[#e6e6e6] px-4 py-4" style={{ backgroundColor: 'rgba(252,252,252,.75)' }}>
        {parameters.length === 0 && <p className="text-[13px] text-[#3b4151]">No parameters</p>}
      {order.map((location) => {
        const group = parameters.filter((parameter) => parameter.in === location)
        if (group.length === 0) return null
        return (
          <div key={location} className="mb-4 last:mb-0">
            <h5 className="mb-2 text-[12px] font-bold uppercase text-[#3b4151]">{location} parameters</h5>
            <div className="overflow-hidden rounded border border-[#e6e6e6] bg-white">
              {group.map((parameter) => (
                <div key={`${location}_${parameter.name}`} className="grid grid-cols-[minmax(120px,0.7fr)_minmax(120px,0.8fr)_minmax(0,1.5fr)] gap-2 border-b border-[#e6e6e6] px-2.5 py-2 text-[11px] last:border-b-0">
                  <div className="min-w-0">
                    <span className="block truncate font-mono font-bold text-[#3b4151]">{parameter.name}</span>
                    {parameter.required && <span className="mt-0.5 inline-block text-[10px] font-bold text-[#ff0000]">required</span>}
                  </div>
                  <div className="min-w-0">{parameter.schema && <SchemaView schema={parameter.schema} registry={registry} depth={5} />}</div>
                  <div className="min-w-0 text-[#3b4151]">{parameter.description || '-'}</div>
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

function ExampleBlock({ example }: { example: unknown }) {
  if (example === undefined || example === null) return null
  const text = typeof example === 'string' ? example : JSON.stringify(example, null, 2)
  return (
    <pre className="max-h-80 overflow-auto rounded bg-[#24272d] p-3 font-mono text-[11px] leading-[18px] text-[#f3f7ff]">
      {text}
    </pre>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="relative m-0 text-[13px] font-bold leading-8 text-[#3b4151] after:absolute after:-bottom-2 after:left-0 after:h-1 after:w-24 after:bg-[#fca130] after:content-['']">
      {children}
    </h4>
  )
}

function statusClass(status: string): string {
  if (status.startsWith('2')) return 'bg-[#49cc90]/15 text-[#17683e]'
  if (status.startsWith('3')) return 'bg-[#61affe]/15 text-[#0f5f9f]'
  if (status.startsWith('4')) return 'bg-[#fca130]/15 text-[#8a5200]'
  if (status.startsWith('5')) return 'bg-[#f93e3e]/15 text-[#9b1c1c]'
  return 'bg-[#ebebeb] text-[#3b4151]'
}
