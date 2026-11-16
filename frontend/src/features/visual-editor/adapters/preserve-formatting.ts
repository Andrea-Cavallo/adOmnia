import { getAstFromContent, getContentFromAst } from '@onlook/parser'

/** Above this many line pairs the merge is skipped: the table would cost more than it saves. */
const MAX_CELLS = 6_000_000

/** A line reduced to what the code generator cannot change: no indentation, no edge punctuation. */
function essence(line: string): string {
  return line.replace(/^[\s();,]+/, '').replace(/[\s();,]+$/, '')
}

/** Longest common subsequence of two string lists, as index pairs. */
function commonLines(a: string[], b: string[]): Array<[number, number]> {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++
    else j++
  }
  return pairs
}

async function canonical(content: string): Promise<string | null> {
  const ast = getAstFromContent(content)
  return ast ? getContentFromAst(ast, content) : null
}

/**
 * The transplanted pipeline rewrites a whole file through the code generator, which also
 * restyles lines the edit never touched (semicolons, parentheses, wrapping). This keeps the
 * user's own text for every line that differs only in formatting and takes the generated text
 * for the rest. The result is accepted only if it regenerates to exactly the same code as
 * `generated`; otherwise `generated` is returned unchanged.
 */
export async function preserveFormatting(original: string, generated: string): Promise<string> {
  if (original === generated) return generated
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const before = original.split(/\r?\n/)
  const after = generated.split(/\r?\n/)
  if (before.length * after.length > MAX_CELLS) return generated

  const pairs = commonLines(before.map(essence), after.map(essence))
  const merged: string[] = []
  let i = 0
  let j = 0
  const flush = (untilBefore: number, untilAfter: number) => {
    // Lines only the user has: keep pure punctuation/blank ones, the edit removed the others.
    for (; i < untilBefore; i++) if (essence(before[i] ?? '') === '') merged.push(before[i] ?? '')
    // Lines only the generator has: real additions (blank ones are generator padding).
    for (; j < untilAfter; j++) if (essence(after[j] ?? '') !== '') merged.push(after[j] ?? '')
  }
  for (const [matchBefore, matchAfter] of pairs) {
    flush(matchBefore, matchAfter)
    merged.push(before[i] ?? '')
    i++
    j++
  }
  flush(before.length, after.length)

  const candidate = merged.join(eol)
  const [expected, actual] = await Promise.all([canonical(generated), canonical(candidate)])
  return expected !== null && expected === actual ? candidate : generated
}
