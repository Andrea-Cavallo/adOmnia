import { useState } from 'react'
import { ChevronRight, CornerDownRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiDocOperation, ApiDocParam, ApiDocSchema } from '@/lib/apidocs/parseSpec'
import { SchemaView } from './SchemaView'

const METHOD_CLASS: Record<string, string> = {
  GET: 'text-method-get border-method-get/40 bg-method-get/10',
  POST: 'text-method-post border-method-post/40 bg-method-post/10',
  PUT: 'text-method-put border-method-put/40 bg-method-put/10',
  PATCH: 'text-method-patch border-method-patch/40 bg-method-patch/10',
  DELETE: 'text-method-delete border-method-delete/40 bg-method-delete/10',
  HEAD: 'text-method-head border-method-head/40 bg-method-head/10',
  OPTIONS: 'text-method-head border-method-head/40 bg-method-head/10',
  QUERY: 'text-info border-info/40 bg-info/10',
  TRACE: 'text-info border-info/40 bg-info/10',
}

interface OperationCardProps {
  operation: ApiDocOperation
  registry: Record<string, ApiDocSchema>
}

export function OperationCard({ operation, registry }: OperationCardProps) {
  const [open, setOpen] = useState(false)
  const methodClass = METHOD_CLASS[operation.method] ?? 'text-text-2 border-border-2 bg-surface-2'

  return (
    <div data-oas-operation={`${operation.method} ${operation.path}`} className="overflow-hidden rounded-lg border border-border-1 bg-surface-1 shadow-sm">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2"
      >
        <ChevronRight size={13} className={cn('shrink-0 text-text-4 transition-transform', open && 'rotate-90')} />
        <span className={cn('w-16 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-bold tracking-wide', methodClass)}>
          {operation.method}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-text-1">{operation.path}</span>
        {operation.deprecated && (
          <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">deprecated</span>
        )}
        {operation.summary && <span className="hidden shrink-0 truncate text-[11px] text-text-3 md:block md:max-w-[40%]">{operation.summary}</span>}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border-1 bg-surface-0/40 px-4 py-3.5">
          {operation.summary && (
            <div className="flex items-start gap-2 text-[12px] text-text-2">
              <CornerDownRight size={13} className="mt-0.5 shrink-0 text-text-4" />
              <span>{operation.summary}</span>
            </div>
          )}
          {operation.description && (
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-3">{operation.description}</p>
          )}

          <ParamGroups parameters={operation.parameters} registry={registry} />

          {operation.requestBody && (
            <section>
              <SectionTitle>Request body{operation.requestBody.required ? ' (required)' : ''}</SectionTitle>
              <div className="mb-2 flex flex-wrap gap-1">
                {operation.requestBody.contentTypes.map((contentType) => (
                  <span key={contentType} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">{contentType}</span>
                ))}
              </div>
              <SchemaView schema={operation.requestBody.schema} registry={registry} />
              <ExampleBlock example={operation.requestBody.example} />
            </section>
          )}

          <section>
            <SectionTitle>Responses</SectionTitle>
            <div className="space-y-2">
              {operation.responses.map((response) => (
                <div key={response.status} className="rounded-md border border-border-2 bg-surface-0 p-2.5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', statusClass(response.status))}>{response.status}</span>
                    {response.description && <span className="text-[11px] text-text-3">{response.description}</span>}
                    {response.contentTypes.map((contentType) => (
                      <span key={contentType} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-4">{contentType}</span>
                    ))}
                  </div>
                  {response.schema && <SchemaView schema={response.schema} registry={registry} />}
                  <ExampleBlock example={response.example} />
                </div>
              ))}
              {operation.responses.length === 0 && <p className="text-[11px] text-text-4">No responses documented.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function ParamGroups({ parameters, registry }: { parameters: ApiDocParam[]; registry: Record<string, ApiDocSchema> }) {
  if (parameters.length === 0) return null
  const order: ApiDocParam['in'][] = ['path', 'query', 'header', 'cookie']
  return (
    <>
      {order.map((location) => {
        const group = parameters.filter((parameter) => parameter.in === location)
        if (group.length === 0) return null
        return (
          <section key={location}>
            <SectionTitle>{location} parameters</SectionTitle>
            <div className="overflow-hidden rounded-md border border-border-2 bg-surface-0">
              {group.map((parameter) => (
                <div key={`${location}_${parameter.name}`} className="grid grid-cols-[minmax(120px,0.7fr)_minmax(120px,0.8fr)_minmax(0,1.5fr)] gap-2 border-b border-border-1 px-2.5 py-2 text-[11px] last:border-b-0">
                  <div className="min-w-0">
                    <span className="block truncate font-mono text-text-1">{parameter.name}</span>
                    {parameter.required && <span className="mt-0.5 inline-block text-[10px] font-semibold text-error">required</span>}
                  </div>
                  <div className="min-w-0">{parameter.schema && <SchemaView schema={parameter.schema} registry={registry} depth={5} />}</div>
                  <div className="min-w-0 text-text-3">{parameter.description || '-'}</div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function ExampleBlock({ example }: { example: unknown }) {
  if (example === undefined || example === null) return null
  const text = typeof example === 'string' ? example : JSON.stringify(example, null, 2)
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border-2 bg-surface-0 p-2.5 font-mono text-[11px] leading-relaxed text-text-2">
      {text}
    </pre>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-4">{children}</h4>
}

function statusClass(status: string): string {
  if (status.startsWith('2')) return 'bg-success/15 text-success'
  if (status.startsWith('3')) return 'bg-info/15 text-info'
  if (status.startsWith('4')) return 'bg-warning/15 text-warning'
  if (status.startsWith('5')) return 'bg-error/15 text-error'
  return 'bg-surface-2 text-text-3'
}
