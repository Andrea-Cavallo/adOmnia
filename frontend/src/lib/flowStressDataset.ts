export type StressDatasetMode = 'shared' | 'per-vu' | 'random'

export interface StressDataset {
  name: string
  columns: string[]
  rows: Array<Record<string, string>>
}

/** Small RFC-4180 compatible parser used locally by Flow Stress datasets. */
export function parseStressDataset(text: string, name = 'dataset.csv'): StressDataset {
  const table: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); table.push(row); row = []; cell = '' }
    else cell += char
  }
  if (quoted) throw new Error('The CSV dataset has an unterminated quoted value.')
  if (cell.length > 0 || row.length > 0) { row.push(cell.replace(/\r$/, '')); table.push(row) }
  const nonEmpty = table.filter((values) => values.some((value) => value.trim() !== ''))
  if (nonEmpty.length < 2) throw new Error('The CSV dataset needs a header and at least one data row.')
  const columns = nonEmpty[0].map((value) => value.trim())
  if (columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(column))) throw new Error('Dataset headers must be valid variable names.')
  if (new Set(columns).size !== columns.length) throw new Error('Dataset headers must be unique.')
  const rows = nonEmpty.slice(1).map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ''])))
  return { name, columns, rows }
}
