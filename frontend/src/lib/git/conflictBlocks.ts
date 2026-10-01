/** Un blocco di conflitto Git (`<<<<<<<` … `=======` … `>>>>>>>`, con base opzionale `|||||||` in stile diff3). */
export interface ConflictBlock {
  /** Righe [start, end] del blocco, marker inclusi (0-based). */
  start: number
  end: number
  ours: string[]
  base: string[] | null
  theirs: string[]
  oursLabel: string
  theirsLabel: string
}

export type ConflictChoice = 'ours' | 'theirs' | 'both' | 'base'

const marker = (line: string, prefix: string): boolean => {
  const clean = line.endsWith('\r') ? line.slice(0, -1) : line
  return clean === prefix || clean.startsWith(prefix + ' ')
}

const label = (line: string): string => line.replace(/\r$/, '').slice(8).trim()

export function findConflictBlocks(text: string): ConflictBlock[] {
  const lines = text.split('\n')
  const blocks: ConflictBlock[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!marker(lines[index], '<<<<<<<')) continue
    const start = index
    const ours: string[] = []
    let base: string[] | null = null
    const theirs: string[] = []
    let section: 'ours' | 'base' | 'theirs' = 'ours'
    let end = -1
    for (index = start + 1; index < lines.length; index++) {
      const line = lines[index]
      if (section === 'ours' && marker(line, '|||||||')) { section = 'base'; base = []; continue }
      if (section !== 'theirs' && marker(line, '=======')) { section = 'theirs'; continue }
      if (section === 'theirs' && marker(line, '>>>>>>>')) { end = index; break }
      if (section === 'ours' && marker(line, '<<<<<<<')) break // marker annidato o rotto: si riparte da qui
      ;(section === 'ours' ? ours : section === 'base' ? base! : theirs).push(line)
    }
    if (end < 0) { index = start; continue }
    blocks.push({ start, end, ours, base, theirs, oursLabel: label(lines[start]), theirsLabel: label(lines[end]) })
  }
  return blocks
}

/** Sostituisce il blocco n. `blockIndex` con la scelta fatta; il resto del testo resta identico. */
export function resolveConflictBlock(text: string, blockIndex: number, choice: ConflictChoice): string {
  const block = findConflictBlocks(text)[blockIndex]
  if (!block) return text
  const replacement = choice === 'ours' ? block.ours
    : choice === 'theirs' ? block.theirs
      : choice === 'base' ? block.base ?? []
        : [...block.ours, ...block.theirs]
  const lines = text.split('\n')
  return [...lines.slice(0, block.start), ...replacement, ...lines.slice(block.end + 1)].join('\n')
}
