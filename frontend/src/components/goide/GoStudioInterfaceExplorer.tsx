import { useMemo, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import type { GoIDEArchInterface, GoIDEArchSite, GoIDEArchitecture } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { interfaceGraph, shortPackage } from './goStudioArchitecture'
import { GoStudioGraphView } from './GoStudioGraphView'
import { layoutLayered } from './goStudioLayeredGraph'

const NODE_COLOR = { interface: 'var(--color-accent)', implementation: 'var(--color-success)', consumer: 'var(--color-info)' } as Record<string, string>

export function openArchSite(site: GoIDEArchSite | undefined): void {
  if (site?.relativePath) void useGoIDEStore.getState().openLocation(site.relativePath, site.line || 1, site.column || 1)
}

export function SiteLink({ site, label }: { site: GoIDEArchSite | undefined; label: string }) {
  if (!site?.relativePath) return <span className="font-mono text-text-3">{label}</span>
  return <button type="button" onClick={() => openArchSite(site)} title={`${site.relativePath}:${site.line}`} className="font-mono text-text-2 hover:text-accent hover:underline">{label}</button>
}

type InterfaceFilter = 'all' | 'hints' | 'single' | 'unimplemented'

function keyOf(item: GoIDEArchInterface): string {
  return `${item.package}.${item.name}`
}

/** Interface Explorer: elenco, implementazioni, chi la usa, metodi mancanti e suggerimenti. */
export function GoStudioInterfaceExplorer({ report, query }: { report: GoIDEArchitecture; query: string }) {
  const [filter, setFilter] = useState<InterfaceFilter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const interfaces = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return report.interfaces.filter((item) => {
      if (needle && !`${item.name} ${item.package} ${item.implementations.map((impl) => impl.type).join(' ')}`.toLowerCase().includes(needle)) return false
      if (filter === 'hints') return item.hints.length > 0
      if (filter === 'single') return item.implementations.length === 1
      if (filter === 'unimplemented') return item.implementations.length === 0
      return true
    })
  }, [filter, query, report.interfaces])
  const selected = interfaces.find((item) => keyOf(item) === selectedKey) ?? interfaces[0] ?? null
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 min-w-[14rem] shrink-0 flex-col border-r border-border-1">
        <div className="flex shrink-0 gap-0.5 border-b border-border-1 p-1">
          {([['all', 'All'], ['hints', 'Hints'], ['single', '1 impl'], ['unimplemented', 'No impl']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded px-1.5 py-0.5 text-[10px] ${filter === id ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3'}`}>{label}</button>
          ))}
        </div>
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {interfaces.map((item) => (
            <li key={keyOf(item)}>
              <button type="button" onClick={() => setSelectedKey(keyOf(item))} className={`flex w-full items-center gap-2 px-2 py-0.5 text-left ${selected && keyOf(selected) === keyOf(item) ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}>
                <span className="min-w-0 flex-1 truncate font-mono">{item.name}</span>
                {item.hints.length > 0 && <Lightbulb size={10} className="shrink-0 text-warning" aria-label="has hints" />}
                <span className="shrink-0 text-[10px] text-text-4" title="implementations · uses">{item.implementations.length} · {item.userCount}</span>
              </button>
            </li>
          ))}
          {!interfaces.length && <li className="px-2 text-text-4">No interfaces match.</li>}
        </ul>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{selected ? <InterfaceDetail item={selected} /> : <p className="text-text-4">No interfaces in the project.</p>}</div>
    </div>
  )
}

function InterfaceDetail({ item }: { item: GoIDEArchInterface }) {
  const graph = useMemo(() => {
    const data = interfaceGraph(item)
    return layoutLayered(data.nodes, data.links)
  }, [item])
  const [selected, setSelected] = useState<string | null>(null)
  const usesByKind = useMemo(() => {
    const groups = new Map<string, GoIDEArchInterface['users']>()
    for (const user of item.users) groups.set(user.kind, [...(groups.get(user.kind) ?? []), user])
    return [...groups.entries()]
  }, [item.users])
  const called = new Set(item.methodUses.map((use) => use.name))
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <SiteLink site={item.site} label={item.name} />
        <span className="text-text-4">{item.package}</span>
      </div>
      {item.hints.map((hint) => (
        <p key={hint.kind} className="flex items-start gap-1.5 rounded border border-warning/30 bg-warning/5 px-2 py-1 text-text-2"><Lightbulb size={11} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />{hint.message}</p>
      ))}
      <section>
        <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">Methods ({item.methods.length}){item.embeds.length ? ` · embeds ${item.embeds.join(', ')}` : ''}</h4>
        <ul className="font-mono text-[10.5px]">
          {item.methods.map((method) => {
            const name = method.split('(')[0]
            const use = item.methodUses.find((entry) => entry.name === name)
            return <li key={method} className={called.has(name) || !item.methodUses.length ? 'text-text-1' : 'text-text-4'} title={use ? `${use.calls} calls through the interface` : 'Never called through the interface'}>{method}{use ? <span className="ml-2 text-text-4">{use.calls}×</span> : null}</li>
          })}
        </ul>
      </section>
      <section>
        <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">Graph · who uses it and who implements it</h4>
        <div className="overflow-auto rounded border border-border-1 p-1">
          <GoStudioGraphView layout={graph} label={`${item.name} interface graph`} selected={selected}
            look={(node) => ({ title: node.data.title, subtitle: node.data.subtitle, tooltip: node.data.tooltip, color: NODE_COLOR[node.data.kind] ?? 'var(--color-text-3)' })}
            onSelect={(node) => setSelected(node.id)} onOpen={(node) => openArchSite(node.data.site)} />
        </div>
      </section>
      <section>
        <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">Implementations ({item.implementations.length})</h4>
        {item.implementations.length ? (
          <ul>{item.implementations.map((impl) => <li key={`${impl.package}.${impl.type}`} className="flex gap-2"><SiteLink site={impl.site} label={`${impl.pointer ? '*' : ''}${impl.type}`} /><span className="text-text-4">{shortPackage(impl.package)}{impl.test ? ' · test' : ''}</span></li>)}</ul>
        ) : <p className="text-text-4">No type in the project implements it.</p>}
      </section>
      {item.nearMisses.length > 0 && (
        <section>
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">Almost implementations · missing methods</h4>
          <ul>{item.nearMisses.map((miss) => <li key={`${miss.package}.${miss.type}`} className="flex gap-2"><SiteLink site={miss.site} label={miss.type} /><span className="text-danger">missing {miss.missing.join(', ')}</span></li>)}</ul>
        </section>
      )}
      <section>
        <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">Who uses this interface? ({item.userCount})</h4>
        {usesByKind.length ? usesByKind.map(([kind, users]) => (
          <div key={kind} className="mb-1">
            <span className="text-[10px] text-text-3">{kind} ({users.length})</span>
            <ul className="pl-3">{users.slice(0, 50).map((user, index) => <li key={index} className="flex gap-2"><SiteLink site={user.site} label={`${user.site.relativePath.split('/').pop()}:${user.site.line}`} />{user.function && <span className="truncate font-mono text-[10px] text-text-4">{user.function}</span>}</li>)}</ul>
          </div>
        )) : <p className="text-text-4">Not used as a type anywhere in the project.</p>}
      </section>
    </div>
  )
}
