import { useMemo, useState } from 'react'
import { Search, Server } from 'lucide-react'
import type { ApiDocModel } from '@/lib/apidocs/parseSpec'
import { OperationCard } from './OperationCard'

interface ApiDocsViewerProps {
  model: ApiDocModel
}

export function ApiDocsViewer({ model }: ApiDocsViewerProps) {
  const [query, setQuery] = useState('')

  const tags = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return model.tags
    return model.tags
      .map((tag) => ({
        ...tag,
        operations: tag.operations.filter(
          (op) =>
            op.path.toLowerCase().includes(q) ||
            op.method.toLowerCase().includes(q) ||
            (op.summary ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((tag) => tag.operations.length > 0)
  }, [model.tags, query])

  return (
    <div className="flex min-h-0 flex-1">
      {/* Tag nav */}
      <nav className="hidden w-52 shrink-0 overflow-y-auto border-r border-border-1 bg-surface-1 p-3 lg:block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">Tags</span>
        <div className="mt-2 space-y-0.5">
          {tags.map((tag) => (
            <a
              key={tag.name}
              href={`#apidoc-tag-${tag.name}`}
              className="flex items-center justify-between rounded px-2 py-1 text-[12px] text-text-3 hover:bg-surface-2 hover:text-text-1"
            >
              <span className="truncate">{tag.name}</span>
              <span className="text-[10px] text-text-4">{tag.operations.length}</span>
            </a>
          ))}
          {tags.length === 0 && <p className="px-2 py-1 text-[11px] text-text-4">No matches.</p>}
        </div>
      </nav>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className="border-b border-border-1 bg-surface-0 px-6 py-5">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold text-text-1">{model.title}</h1>
            {model.version && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-3">v{model.version}</span>
            )}
            <span className="ml-auto text-[11px] text-text-4">{model.operationCount} operations</span>
          </div>
          {model.description && (
            <p className="mt-2 max-w-3xl whitespace-pre-wrap text-[12px] leading-relaxed text-text-3">{model.description}</p>
          )}
          {model.servers.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Server size={12} className="text-text-4" />
              {model.servers.map((s) => (
                <span key={s} className="rounded border border-border-2 bg-surface-1 px-2 py-0.5 font-mono text-[11px] text-text-2">{s}</span>
              ))}
            </div>
          )}
        </header>

        <div className="sticky top-0 z-10 border-b border-border-1 bg-surface-0/95 px-6 py-2 backdrop-blur">
          <div className="flex h-8 max-w-md items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-2">
            <Search size={13} className="text-text-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter operations by path, method, or summary…"
              className="h-full flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-4"
            />
          </div>
        </div>

        <div className="space-y-8 px-6 py-5">
          {tags.map((tag) => (
            <section key={tag.name} id={`apidoc-tag-${tag.name}`} className="scroll-mt-16">
              <div className="mb-2">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-text-2">{tag.name}</h2>
                {tag.description && <p className="mt-0.5 text-[12px] text-text-3">{tag.description}</p>}
              </div>
              <div className="space-y-2">
                {tag.operations.map((op) => (
                  <OperationCard key={`${op.method}_${op.path}`} operation={op} registry={model.schemaRegistry} />
                ))}
              </div>
            </section>
          ))}
          {tags.length === 0 && (
            <p className="py-10 text-center text-[12px] text-text-4">No operations match “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  )
}
