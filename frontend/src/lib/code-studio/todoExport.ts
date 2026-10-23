export interface TodoExportItem {
  keyword: string
  text: string
  relativePath: string
  line: number
}

/** Un servizio/modulo del progetto: `root` assoluta, `name` es. il module path. */
export interface TodoExportUnit {
  root: string
  name?: string
  kind?: string
}

const OTHER = '(outside any module)'
/** Toglie le barre finali dalla coda: la regex `\/+$` ha backtracking non lineare sui percorsi lunghi. */
const withoutTrailingSlashes = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}
const normalize = (path: string) => withoutTrailingSlashes(path.replace(/\\/g, '/'))
const escapeCell = (text: string) => text.replace(/[\\|]/g, '\\$&').replace(/\r?\n/g, ' ')

// Cartelle che contengono servizi: il servizio è la sottocartella (services/auth), non la cartella stessa.
const SERVICE_CONTAINERS = new Set(['services', 'service', 'microservices', 'apps', 'cmd', 'packages', 'svc'])

/** Senza go.mod/pom.xml: il servizio è la prima cartella (o la seconda sotto `services/`…); null per i file in radice. */
function serviceFolder(path: string): string | null {
  const parts = path.split('/')
  if (parts.length < 2) return null
  return SERVICE_CONTAINERS.has(parts[0].toLowerCase()) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0]
}

interface Group { title: string; dir: string; items: TodoExportItem[] }

/** Assegna ogni TODO all'unità (modulo/servizio) più profonda che contiene il file. */
function groupByUnit(items: readonly TodoExportItem[], projectRoot: string, units: readonly TodoExportUnit[]): Group[] {
  const root = normalize(projectRoot)
  const candidates = units
    .filter((unit) => unit.kind !== 'workspace' && unit.kind !== 'loose')
    .map((unit) => {
      const abs = normalize(unit.root)
      const dir = abs === root ? '' : abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs
      return { dir, title: unit.name || dir || '(project root)' }
    })
    .sort((a, b) => b.dir.length - a.dir.length)
  const groups = new Map<string, Group>()
  for (const item of items) {
    const path = normalize(item.relativePath)
    const owner = candidates.find((unit) => unit.dir === '' || path === unit.dir || path.startsWith(`${unit.dir}/`))
    const folder = owner ? null : serviceFolder(path)
    const key = owner ? owner.dir : folder ?? OTHER
    const group = groups.get(key) ?? { title: owner ? owner.title : folder ?? OTHER, dir: owner ? owner.dir : folder ?? '', items: [] }
    groups.set(key, { ...group, items: [...group.items, item] })
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title))
}

function countLine(items: readonly TodoExportItem[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.keyword, (counts.get(item.keyword) ?? 0) + 1)
  return [...counts.entries()].map(([keyword, count]) => `${keyword} ${count}`).join(' · ')
}

/** Report Markdown dei TODO: riepilogo, poi una sezione per modulo, poi per file. */
export function todosToMarkdown(items: readonly TodoExportItem[], options: { projectName: string; projectRoot: string; units: readonly TodoExportUnit[]; date?: Date }): string {
  const groups = groupByUnit(items, options.projectRoot, options.units)
  const date = (options.date ?? new Date()).toISOString().slice(0, 10)
  const out: string[] = [`# TODO report — ${options.projectName}`, '', `Generated ${date} by adOmnia · ${items.length} open items${items.length ? ` (${countLine(items)})` : ''}`, '']
  if (items.length === 0) return `${out.join('\n')}\nNo TODO, FIXME, XXX or BUG comments found.\n`
  out.push('## Summary', '', '| Module | Items | Breakdown |', '| --- | ---: | --- |')
  for (const group of groups) out.push(`| ${escapeCell(group.title)} | ${group.items.length} | ${countLine(group.items)} |`)
  out.push('')
  for (const group of groups) {
    out.push(`## ${group.title}`, '', group.dir ? `\`${group.dir}/\` · ${group.items.length} items` : `${group.items.length} items`, '')
    const byFile = new Map<string, TodoExportItem[]>()
    for (const item of group.items) byFile.set(item.relativePath, [...(byFile.get(item.relativePath) ?? []), item])
    for (const [file, entries] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`### \`${file}\``, '')
      for (const entry of [...entries].sort((a, b) => a.line - b.line)) out.push(`- [ ] **${entry.keyword}** (L${entry.line}) ${escapeCell(entry.text)}`)
      out.push('')
    }
  }
  return `${out.join('\n').trimEnd()}\n`
}
