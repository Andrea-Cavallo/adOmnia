import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { resolveSchemaRef, refName, type ApiDocSchema } from '@/lib/apidocs/parseSpec'

interface SchemaViewProps {
  schema?: ApiDocSchema
  registry: Record<string, ApiDocSchema>
  depth?: number
  required?: boolean
}

const MAX_DEPTH = 7

function typeLabel(schema: ApiDocSchema): string {
  if (schema.$ref) return refName(schema.$ref)
  const t = typeof schema.type === 'string' ? schema.type : undefined
  if (t === 'array') {
    const items = schema.items as ApiDocSchema | undefined
    const inner = items ? typeLabel(items) : 'any'
    return `${inner}[]`
  }
  if (Array.isArray(schema.enum)) return t ?? 'enum'
  const format = typeof schema.format === 'string' ? `<${schema.format}>` : ''
  return (t ?? 'object') + format
}

export function SchemaView({ schema, registry, depth = 0, required }: SchemaViewProps) {
  if (!schema) return <span className="text-text-4 text-[11px]">no schema</span>
  if (depth > MAX_DEPTH) return <span className="text-text-4 text-[11px]">…</span>

  // Resolve a top-level $ref once so we can render its shape.
  let resolved = schema
  let refLabel: string | null = null
  if (schema.$ref) {
    refLabel = refName(schema.$ref)
    const target = resolveSchemaRef(schema.$ref, registry)
    if (!target) return <TypePill text={refLabel} unknownRef />
    resolved = target
  }

  const type = typeof resolved.type === 'string' ? resolved.type : (resolved.properties ? 'object' : undefined)

  if (type === 'object' || resolved.properties) {
    return <ObjectSchema schema={resolved} registry={registry} depth={depth} title={refLabel} required={required} />
  }

  if (type === 'array') {
    const items = resolved.items as ApiDocSchema | undefined
    return (
      <div className="text-[11px]">
        <TypePill text={typeLabel(resolved)} />
        {items && (items.properties || items.$ref) && (
          <div className="mt-1 border-l border-border-2 pl-3">
            <SchemaView schema={items} registry={registry} depth={depth + 1} />
          </div>
        )}
      </div>
    )
  }

  // Primitive
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <TypePill text={typeLabel(resolved)} />
      {required && <span className="text-error text-[10px] font-semibold">required</span>}
      {Array.isArray(resolved.enum) && (
        <span className="text-text-4">enum: {resolved.enum.map((e) => String(e)).join(' | ')}</span>
      )}
      {typeof resolved.description === 'string' && <span className="text-text-3">— {resolved.description}</span>}
    </div>
  )
}

function ObjectSchema({
  schema,
  registry,
  depth,
  title,
  required,
}: {
  schema: ApiDocSchema
  registry: Record<string, ApiDocSchema>
  depth: number
  title: string | null
  required?: boolean
}) {
  const [open, setOpen] = useState(depth < 1)
  const properties = (schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {}) as Record<string, ApiDocSchema>
  const requiredKeys = new Set(Array.isArray(schema.required) ? schema.required.map(String) : [])
  const entries = Object.entries(properties)

  return (
    <div className="text-[11px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-text-2 hover:text-text-1"
      >
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <TypePill text={title ?? 'object'} />
        {required && <span className="text-error text-[10px] font-semibold">required</span>}
        <span className="text-text-4">{entries.length} field{entries.length === 1 ? '' : 's'}</span>
      </button>
      {open && entries.length > 0 && (
        <div className="mt-1 space-y-1.5 border-l border-border-2 pl-3">
          {entries.map(([key, propSchema]) => (
            <div key={key}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-text-1">{key}</span>
                <TypePill text={typeLabel(propSchema)} subtle />
                {requiredKeys.has(key) && <span className="text-error text-[10px] font-semibold">required</span>}
                {typeof propSchema.description === 'string' && (
                  <span className="text-text-3">— {propSchema.description}</span>
                )}
              </div>
              {(propSchema.properties || propSchema.$ref || propSchema.type === 'array') && (
                <div className="mt-1 pl-3">
                  <SchemaView schema={propSchema} registry={registry} depth={depth + 1} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TypePill({ text, subtle, unknownRef }: { text: string; subtle?: boolean; unknownRef?: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
        unknownRef
          ? 'bg-warning/10 text-warning'
          : subtle
            ? 'bg-surface-2 text-text-3'
            : 'bg-accent/10 text-accent'
      }`}
      title={unknownRef ? 'Unresolved $ref' : undefined}
    >
      {text}
    </span>
  )
}
