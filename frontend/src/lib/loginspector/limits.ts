// Memory budgets for the Log Inspector. Events are also capped by count
// (DEFAULT_MAX_EVENTS); these limits stop a few enormous lines from holding
// more memory than the whole session is worth.
import { utf8ByteLength } from '@/lib/textBytes'

export { utf8ByteLength }

export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
export const LIVE_SOURCE_MAX_LINES = 20_000
export const LIVE_SOURCE_MAX_BYTES = 8 * 1024 * 1024

/**
 * Keep the newest lines within both budgets. The most recent line is kept even
 * when it alone is bigger than the byte budget.
 */
export function trimTextToBudget(text: string, maxLines: number, maxBytes: number): string {
  const lines = text.split('\n')
  let start = Math.max(0, lines.length - maxLines)
  let bytes = utf8ByteLength(lines.slice(start).join('\n'))
  while (start < lines.length - 1 && bytes > maxBytes) {
    bytes -= utf8ByteLength(lines[start]) + 1
    start++
  }
  return lines.slice(start).join('\n')
}
