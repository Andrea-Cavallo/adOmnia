export interface GoStudioMemoryRow {
  address: string
  hex: string[]
  ascii: string
}

/** Righe da 16 byte: indirizzo, byte esadecimali e caratteri stampabili (gli altri come "."). */
export function memoryDumpRows(address: string, bytes: number[], width = 16): GoStudioMemoryRow[] {
  const start = BigInt(address)
  const rows: GoStudioMemoryRow[] = []
  for (let offset = 0; offset < bytes.length; offset += width) {
    const chunk = bytes.slice(offset, offset + width)
    rows.push({
      address: `0x${(start + BigInt(offset)).toString(16).padStart(12, '0')}`,
      hex: chunk.map((value) => value.toString(16).padStart(2, '0')),
      ascii: chunk.map((value) => (value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : '.')).join(''),
    })
  }
  return rows
}
