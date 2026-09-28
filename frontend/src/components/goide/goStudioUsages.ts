import type { GoIDEEditorLocation } from '@/lib/goide-lsp-api'

export type GoStudioUsageKind = 'declaration' | 'write' | 'read' | 'import' | 'other'

export interface GoStudioUsageGroup {
  kind: GoStudioUsageKind
  label: string
  count: number
  files: Array<[string, GoIDEEditorLocation[]]>
}

const ORDER: ReadonlyArray<{ kind: GoStudioUsageKind; label: string }> = [
  { kind: 'declaration', label: 'Declaration' },
  { kind: 'write', label: 'Write access' },
  { kind: 'read', label: 'Read access' },
  { kind: 'import', label: 'Import' },
  { kind: 'other', label: 'Usages' },
]

/** Raggruppa per file mantenendo l'ordine di arrivo (già ordinato per percorso e riga dal backend). */
export function groupByFile(locations: GoIDEEditorLocation[]): Array<[string, GoIDEEditorLocation[]]> {
  const groups = new Map<string, GoIDEEditorLocation[]>()
  for (const location of locations) {
    const key = location.relativePath || location.path
    groups.set(key, [...(groups.get(key) ?? []), location])
  }
  return [...groups.entries()]
}

function usageKind(location: GoIDEEditorLocation): GoStudioUsageKind {
  const usage = location.usage
  return usage === 'declaration' || usage === 'write' || usage === 'read' || usage === 'import' ? usage : 'other'
}

/** Come GoLand: dichiarazione, scritture, letture e import in sezioni separate, poi per file. */
export function groupUsagesByKind(locations: GoIDEEditorLocation[]): GoStudioUsageGroup[] {
  return ORDER
    .map(({ kind, label }) => {
      const matching = locations.filter((location) => usageKind(location) === kind)
      return { kind, label, count: matching.length, files: groupByFile(matching) }
    })
    .filter((group) => group.count > 0)
}

/** Vero quando il backend ha classificato gli utilizzi (Find Usages); falso per Implementations. */
export function hasUsageKinds(locations: GoIDEEditorLocation[]): boolean {
  return locations.some((location) => !!location.usage)
}
