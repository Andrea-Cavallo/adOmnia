#!/usr/bin/env node
// Divario reale di `new_coverage` su SonarCloud: righe nuove scoperte per file, aggregate per area,
// e quante righe servono per arrivare alla soglia.
//
// Uso: node scripts/coverage-gap.mjs [--branch main] [--threshold 80] [--top 20]
// Non richiede token: il progetto è pubblico e le API di misura sono in lettura.
import { writeFileSync, mkdirSync } from 'node:fs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '')
  args.set(key, process.argv[i + 1])
}
const branch = args.get('branch') ?? 'main'
const threshold = Number(args.get('threshold') ?? 80)
const top = Number(args.get('top') ?? 20)
const project = args.get('project') ?? 'Andrea-Cavallo_adOmnia'
const base = 'https://sonarcloud.io/api/measures/component_tree'
const pageSize = 500

async function page(index) {
  const url = `${base}?component=${encodeURIComponent(project)}&branch=${encodeURIComponent(branch)}`
    + `&metricKeys=new_lines_to_cover,new_uncovered_lines&qualifiers=FIL&ps=${pageSize}&p=${index}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Sonar ha risposto ${response.status} per ${url}`)
  return response.json()
}

const measure = (component, metric) => {
  const found = component.measures?.find((m) => m.metric === metric)
  const period = found?.periods?.[0]
  return period ? Number(period.value) : 0
}

const first = await page(1)
const pages = Math.ceil(first.paging.total / pageSize)
const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2)))
const components = [first, ...rest].flatMap((payload) => payload.components ?? [])

const files = components
  .map((component) => ({
    file: String(component.key).replace(/^[^:]+:/, ''),
    toCover: measure(component, 'new_lines_to_cover'),
    uncovered: measure(component, 'new_uncovered_lines'),
  }))
  .filter((entry) => entry.toCover > 0)

const totalToCover = files.reduce((sum, entry) => sum + entry.toCover, 0)
const totalUncovered = files.reduce((sum, entry) => sum + entry.uncovered, 0)
const allowed = Math.floor((totalToCover * (100 - threshold)) / 100)
const needed = Math.max(0, totalUncovered - allowed)
const coverage = totalToCover === 0 ? 0 : ((totalToCover - totalUncovered) / totalToCover) * 100

const areaOf = (file) => {
  const normalized = file.replace(/\\/g, '/')
  if (normalized.startsWith('frontend/')) return 'frontend'
  const internal = /^internal\/([^/]+)/.exec(normalized)
  if (internal) return `internal/${internal[1]}`
  const other = /^(scripts|cmd|build|packaging)\//.exec(normalized)
  return other ? other[1] : 'altro'
}

const areas = new Map()
for (const entry of files) {
  const area = areaOf(entry.file)
  const bucket = areas.get(area) ?? { area, files: 0, toCover: 0, uncovered: 0 }
  bucket.files += 1
  bucket.toCover += entry.toCover
  bucket.uncovered += entry.uncovered
  areas.set(area, bucket)
}

const byArea = [...areas.values()].sort((a, b) => b.uncovered - a.uncovered)
const worst = [...files].sort((a, b) => b.uncovered - a.uncovered).slice(0, top)

const pct = (value) => `${value.toFixed(1)}%`
const line = (cells) => `| ${cells.join(' | ')} |`
const out = []
out.push(`# Coverage on new code — ${project}@${branch}`)
out.push('')
out.push(line(['', 'Valore']))
out.push(line(['---', '---']))
out.push(line(['Righe nuove da coprire', String(totalToCover)]))
out.push(line(['Righe nuove scoperte', String(totalUncovered)]))
out.push(line(['Coverage', pct(coverage)]))
out.push(line([`Soglia`, `${threshold}%`]))
out.push(line([`Scoperte massime consentite`, String(allowed)]))
out.push(line([`**Righe ancora da coprire**`, `**${needed}**`]))
out.push('')
out.push('## Per area')
out.push('')
out.push(line(['Area', 'File', 'Da coprire', 'Scoperte', 'Coverage']))
out.push(line(['---', '---:', '---:', '---:', '---:']))
for (const area of byArea) {
  if (area.uncovered === 0) continue
  const areaCoverage = area.toCover === 0 ? 0 : ((area.toCover - area.uncovered) / area.toCover) * 100
  out.push(line([area.area, String(area.files), String(area.toCover), String(area.uncovered), pct(areaCoverage)]))
}
out.push('')
out.push(`## I ${top} file con più righe scoperte`)
out.push('')
out.push(line(['File', 'Da coprire', 'Scoperte']))
out.push(line(['---', '---:', '---:']))
for (const entry of worst) out.push(line([entry.file, String(entry.toCover), String(entry.uncovered)]))

const report = out.join('\n')
console.log(report)
if (args.has('json')) {
  writeFileSync(args.get('json'), JSON.stringify(files, null, 2))
  console.error(`scritto ${args.get('json')}`)
}
if (args.has('out')) {
  const dir = args.get('out').replace(/[\\/][^\\/]+$/, '')
  if (dir) mkdirSync(dir, { recursive: true })
  writeFileSync(args.get('out'), `${report}\n`)
  console.error(`scritto ${args.get('out')}`)
}
process.exitCode = needed === 0 ? 0 : 1
