import type { LogFormat } from './types'

// ANSI CSI/OSC sequences emitted by `oc logs`, kubectl and coloured loggers.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** True when the trimmed text is a complete JSON object or array. */
export function isJsonDocument(text: string): boolean {
  const t = text.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

/**
 * Index of the first `{` that starts a parsable JSON object running to the end
 * of the line, or -1. Handles the `<timestamp> stdout F {json}` shape that
 * OpenShift/CRI-O writes, and any other textual prefix.
 */
export function findJsonSuffix(line: string): number {
  let from = line.indexOf('{')
  while (from !== -1) {
    const candidate = line.slice(from).trim()
    if (candidate.endsWith('}')) {
      try {
        const parsed = JSON.parse(candidate)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return from
      } catch {
        /* keep looking — the brace belonged to prose */
      }
    }
    from = line.indexOf('{', from + 1)
  }
  return -1
}

/**
 * Sniff the shape of a whole paste. Only the first lines are inspected so that
 * detection stays O(1) on a 100k-line file.
 */
export function detectFormat(text: string): LogFormat {
  const trimmed = stripAnsi(text).trim()
  if (!trimmed) return 'empty'

  if (isJsonDocument(trimmed)) return trimmed[0] === '[' ? 'json-array' : 'json'

  const sample = trimmed.split(/\r?\n/, 60).filter((l) => l.trim() !== '')
  if (sample.length === 0) return 'empty'

  let pureJson = 0
  let withPrefix = 0
  for (const line of sample) {
    const t = line.trim()
    if (t.startsWith('{') && isJsonDocument(t)) pureJson++
    else if (findJsonSuffix(line) > 0) withPrefix++
  }

  const structured = pureJson + withPrefix
  if (structured === 0) return 'text'
  if (withPrefix > 0 || structured < sample.length) return 'mixed'
  return 'jsonl'
}
