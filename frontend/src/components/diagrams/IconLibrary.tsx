/**
 * The icon library: technology logos (languages, databases, messaging, cloud, tools… plus every
 * other brand of Simple Icons) and AWS architecture icons. Pick a set, narrow it with a category
 * chip, search by name, category or alias; recently used icons stay on top. The manifest and the
 * pictures are static files loaded only when this tab opens. Drag an icon onto the canvas or click
 * it to place it in the middle of the view: it becomes an image node, resizable and connectable.
 */
import { memo, useEffect, useMemo, useState, type DragEvent } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DIAGRAM_ICON_BASE } from '@/lib/diagrams/blueprint'
import { ICON_DRAG_TYPE } from './dragTypes'

const BASE = DIAGRAM_ICON_BASE
/** Icons shown per category before "Show all", so a few thousand pictures never load at once. */
const PREVIEW_COUNT = 16
const RECENT_KEY = 'adomnia.diagrams.recentIcons'
const RECENT_LIMIT = 12

export interface IconEntry {
  /** Set: `tech` (Simple Icons) or `aws`. */
  s: 'tech' | 'aws'
  n: string
  c: string
  k: 'brand' | 'service' | 'resource' | 'category'
  p: string
  /** Other names the brand is known by. */
  a?: string
}
interface IconSet { id: IconEntry['s']; label: string; categories: string[] }
interface Manifest { sets: IconSet[]; icons: IconEntry[] }
type AwsKind = 'all' | 'service' | 'resource' | 'category'

let manifest: Promise<Manifest> | null = null
function loadManifest(): Promise<Manifest> {
  manifest ??= fetch(`${BASE}manifest.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<Manifest>
    })
    .catch((error: unknown) => {
      manifest = null
      throw error
    })
  return manifest
}

/** Icons whose name, category or aliases contain every word of the query. */
export function searchIcons(icons: readonly IconEntry[], query: string): IconEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...icons]
  return icons.filter((icon) => {
    const haystack = `${icon.n} ${icon.c} ${icon.a ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return [] // private window or damaged entry: no recent icons, nothing else changes
  }
}

function rememberRecent(path: string): string[] {
  const next = [path, ...readRecent().filter((item) => item !== path)].slice(0, RECENT_LIMIT)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage unavailable: the list just is not kept */ }
  return next
}

const IconTile = memo(function IconTile({ icon, onAdd }: { icon: IconEntry; onAdd: (icon: IconEntry) => void }) {
  const src = `${BASE}${icon.p}`
  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(ICON_DRAG_TYPE, JSON.stringify({ src, label: icon.n }))
    event.dataTransfer.effectAllowed = 'copy'
    rememberRecent(icon.p)
  }
  return (
    <button type="button" className="diagram-icon-tile" draggable onDragStart={onDragStart} onClick={() => onAdd(icon)} title={`${icon.n} · ${icon.c}`}>
      <img src={src} alt="" loading="lazy" width={28} height={28} />
      <span>{icon.n}</span>
    </button>
  )
})

function CategoryGroup({ title, icons, open, onOpen, onAdd }: { title: string; icons: IconEntry[]; open: boolean; onOpen: () => void; onAdd: (icon: IconEntry) => void }) {
  const shown = open ? icons : icons.slice(0, PREVIEW_COUNT)
  return (
    <section className="diagram-library-group">
      <h3>{title}<span>{icons.length}</span></h3>
      <div className="diagram-icon-tiles">{shown.map((icon) => <IconTile key={icon.p} icon={icon} onAdd={onAdd} />)}</div>
      {shown.length < icons.length && <button type="button" className="diagram-inspector-action" onClick={onOpen}>Show all {icons.length}</button>}
    </section>
  )
}

export function IconLibrary({ onAdd }: { onAdd: (src: string, label: string) => void }) {
  const [data, setData] = useState<Manifest | null>(null)
  const [error, setError] = useState('')
  const [set, setSet] = useState<IconEntry['s']>('tech')
  const [category, setCategory] = useState('')
  const [awsKind, setAwsKind] = useState<AwsKind>('service')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [recent, setRecent] = useState<string[]>(readRecent)

  useEffect(() => {
    let alive = true
    loadManifest().then(
      (loaded) => { if (alive) setData(loaded) },
      (cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) },
    )
    return () => { alive = false }
  }, [])

  const add = (icon: IconEntry) => {
    setRecent(rememberRecent(icon.p))
    onAdd(`${BASE}${icon.p}`, icon.n)
  }
  const pickSet = (next: IconEntry['s']) => { setSet(next); setCategory(''); setExpanded(new Set()) }

  const { groups, counts, otherMatches, recentIcons } = useMemo(() => {
    const all = data?.icons ?? []
    const ofSet = all.filter((icon) => icon.s === set && (set !== 'aws' || awsKind === 'all' || icon.k === awsKind))
    const perCategory = new Map<string, number>()
    for (const icon of ofSet) perCategory.set(icon.c, (perCategory.get(icon.c) ?? 0) + 1)
    const matches = searchIcons(ofSet, query).filter((icon) => !category || icon.c === category)
    const byCategory = new Map<string, IconEntry[]>()
    for (const icon of matches) byCategory.set(icon.c, [...(byCategory.get(icon.c) ?? []), icon])
    const order = data?.sets.find((candidate) => candidate.id === set)?.categories ?? []
    const byPath = new Map(all.map((icon) => [icon.p, icon]))
    return {
      groups: [...byCategory].sort(([a], [b]) => (order.indexOf(a) - order.indexOf(b)) || a.localeCompare(b)),
      counts: perCategory,
      otherMatches: query.trim() ? searchIcons(all.filter((icon) => icon.s !== set), query).length : 0,
      recentIcons: recent.flatMap((path) => byPath.get(path) ?? []),
    }
  }, [data, set, awsKind, query, category, recent])

  const sets = data?.sets ?? []
  const categories = sets.find((candidate) => candidate.id === set)?.categories.filter((name) => counts.has(name)) ?? []
  const otherSet = sets.find((candidate) => candidate.id !== set)

  return (
    <>
      <div className="diagram-icon-sets" role="tablist" aria-label="Icon set">
        {sets.map((candidate) => (
          <button key={candidate.id} type="button" role="tab" aria-selected={set === candidate.id} className={cn(set === candidate.id && 'is-active')} onClick={() => pickSet(candidate.id)}>
            {candidate.label}
          </button>
        ))}
      </div>
      <label className="diagram-search">
        <Search size={12} aria-hidden="true" />
        <span className="sr-only">Search icons</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={set === 'tech' ? 'Kafka, MongoDB, Go, Kubernetes…' : 'Lambda, S3, API Gateway…'} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={11} /></button>}
      </label>
      {set === 'aws' && (
        <div className="diagram-icon-chips" role="group" aria-label="AWS icon kind">
          {(['service', 'resource', 'category', 'all'] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={awsKind === kind} onClick={() => setAwsKind(kind)}>{{ service: 'Services', resource: 'Resources', category: 'Categories', all: 'All' }[kind]}</button>
          ))}
        </div>
      )}
      <select className="diagram-input diagram-icon-filter" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
        <option value="">All categories ({[...counts.values()].reduce((sum, count) => sum + count, 0)})</option>
        {categories.map((name) => <option key={name} value={name}>{name} ({counts.get(name)})</option>)}
      </select>
      <div className="diagram-library-scroll">
        {error && <p className="diagram-empty-hint">Icons could not be loaded: {error}</p>}
        {!data && !error && <p className="diagram-empty-hint">Loading icons…</p>}
        {data && !query && !category && recentIcons.length > 0 && (
          <section className="diagram-library-group">
            <h3>Recently used</h3>
            <div className="diagram-icon-tiles">{recentIcons.map((icon) => <IconTile key={`r-${icon.p}`} icon={icon} onAdd={add} />)}</div>
          </section>
        )}
        {groups.map(([name, list]) => (
          <CategoryGroup key={name} title={name} icons={list} open={query.trim() !== '' || category !== '' || expanded.has(name)}
            onOpen={() => setExpanded((current) => new Set([...current, name]))} onAdd={add} />
        ))}
        {data && groups.length === 0 && <p className="diagram-empty-hint">No icon matches “{query}” here.</p>}
        {otherMatches > 0 && otherSet && (
          <button type="button" className="diagram-inspector-action" onClick={() => pickSet(otherSet.id)}>{otherMatches} more in {otherSet.label}</button>
        )}
        <p className="diagram-empty-hint">
          {set === 'aws'
            ? 'AWS Architecture Icons © Amazon.com, Inc. or its affiliates, used under the AWS icon terms for architecture diagrams. Not covered by adOmnia’s license.'
            : 'Logos from the Simple Icons collection (CC0). Brand names and logos are trademarks of their owners, shown only to identify the technology.'}
        </p>
      </div>
    </>
  )
}
