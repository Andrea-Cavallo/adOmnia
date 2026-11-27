import type { BsonDoc } from './bson'

/** Parses an imported file: JSON array/object, NDJSON (one doc per line) or CSV with a header row. */
export function parseImportFile(fileName: string, text: string): BsonDoc[] {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) throw new Error('File is empty')
  if (/\.csv$/i.test(fileName)) return parseCsvDocuments(trimmed)
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const docs = Array.isArray(parsed) ? parsed : [parsed]
    if (!docs.every((d) => d && typeof d === 'object' && !Array.isArray(d))) throw new Error('JSON must be a document or an array of documents')
    return docs as BsonDoc[]
  } catch (e) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) throw e
    return lines.map((line, i) => {
      try { return JSON.parse(line) as BsonDoc } catch { throw new Error(`Line ${i + 1} is not valid JSON`) }
    })
  }
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((r) => r.some((c) => c !== ''))
}

function csvValue(raw: string): unknown {
  if (raw === '') return undefined
  if (raw === 'true' || raw === 'false') return raw === 'true'
  if (raw === 'null') return null
  // Keep leading zeros (zip codes, ids) as strings.
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

function parseCsvDocuments(text: string): BsonDoc[] {
  const [header, ...rows] = parseCsvRows(text)
  if (!header?.length) throw new Error('CSV needs a header row')
  return rows.map((cells) => {
    const doc: BsonDoc = {}
    header.forEach((column, i) => {
      const value = csvValue(cells[i] ?? '')
      if (value === undefined) return
      // Dotted headers (address.city) become embedded documents.
      const parts = column.trim().split('.')
      let target = doc
      parts.slice(0, -1).forEach((part) => {
        if (typeof target[part] !== 'object' || target[part] === null) target[part] = {}
        target = target[part] as BsonDoc
      })
      target[parts[parts.length - 1]] = value
    })
    return doc
  })
}

/** Dotted columns for nested objects; arrays and empty objects stay one JSON cell (re-importable as CSV). */
function flattenForCsv(value: unknown, prefix: string, out: Record<string, unknown>): void {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flattenForCsv(v, prefix ? `${prefix}.${k}` : k, out)
    return
  }
  out[prefix] = value
}

/** Serializes relaxed (toEditable) documents as CSV, header = union of dotted paths in first-seen order. */
export function documentsToCsv(docs: unknown[], escape: (v: unknown) => string): string {
  const rows = docs.map((doc) => { const out: Record<string, unknown> = {}; flattenForCsv(doc, '', out); return out })
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return [columns.map((c) => escape(c)).join(','), ...rows.map((row) => columns.map((c) => escape(row[c])).join(','))].join('\n')
}
