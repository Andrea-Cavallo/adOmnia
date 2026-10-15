/**
 * Snippet mechanics for the database query console (FIX.md DB-3.1.3).
 *
 * Pure module: no React, no DOM, no I/O.
 *
 * Syntax:
 * - `${1:default}`  numbered tab stop showing `default` as its text
 * - `${2|a,b|}`     tab stop with choices; the first choice is the default
 * - `$0` / `${0}`   final exit stop (usually empty)
 * - `\$`            a literal `$`
 *
 * Text outside stops is kept verbatim. Placeholder text may contain nested
 * braces (`${1:{$gte: 1}}`) and literal `$` characters (`${1:$field}`); a `$`
 * that would start a stop can be escaped as `\$`. Stops that repeat the same
 * number share a single value: every occurrence renders the same text.
 *
 * A stop's "current text" is what the buffer shows while the snippet is being
 * filled in: its placeholder text, its first choice, or nothing. That is
 * exactly `renderSnippetText(parsed, {})`, so the positions returned by
 * `activeStop()` line up with it.
 */

export interface SnippetSegment {
  /** Literal text, or the current text of a stop (placeholder / first choice / ''). */
  text: string
  /** Stop number (0 = final exit), absent for literal segments. */
  stop?: number
  /** Default text of `${N:text}`. */
  placeholder?: string
  /** Choices of `${N|a,b|}`; the first one is the default. */
  choices?: string[]
}

export interface ParsedSnippet {
  segments: SnippetSegment[]
  /**
   * Number of tab positions: the numbered stops 1..n in order, plus the final
   * $0 when present. Position `stops` is therefore the exit position when the
   * snippet ends with `$0`. Stops that repeat a number count once.
   */
  stops: number
}

const BARE_STOP = /^\$(\d+)/
const BRACED_STOP = /^\$\{(\d+)/
const CHOICE_ESCAPES = ',|$\\'

function tabOrder(segments: SnippetSegment[]): number[] {
  const seen = new Set<number>()
  for (const seg of segments) {
    if (seg.stop !== undefined) seen.add(seg.stop)
  }
  const order = [...seen].filter((n) => n !== 0).sort((a, b) => a - b)
  if (seen.has(0)) order.push(0)
  return order
}

/** Splits `a,b` into choices, honouring `\,`, `\|`, `\$` and `\\` escapes. */
function splitChoices(raw: string): string[] {
  const out: string[] = []
  let current = ''
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\\' && i + 1 < raw.length && CHOICE_ESCAPES.includes(raw[i + 1])) {
      current += raw[i + 1]
      i += 2
      continue
    }
    if (ch === ',') {
      out.push(current)
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  out.push(current)
  return out
}

/**
 * Parses snippet syntax into literal and stop segments. Tolerant: unknown or
 * unterminated constructs degrade to literal text instead of throwing.
 */
export function parseSnippet(body: string): ParsedSnippet {
  const segments: SnippetSegment[] = []
  const numbers = new Set<number>()
  let literal = ''

  const flush = () => {
    if (literal) {
      segments.push({ text: literal })
      literal = ''
    }
  }
  const addStop = (stop: number, placeholder?: string, choices?: string[]) => {
    flush()
    numbers.add(stop)
    const segment: SnippetSegment = { text: placeholder ?? choices?.[0] ?? '', stop }
    if (placeholder !== undefined) segment.placeholder = placeholder
    if (choices !== undefined) segment.choices = choices
    segments.push(segment)
  }

  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '\\' && body[i + 1] === '$') {
      literal += '$'
      i += 2
      continue
    }
    if (ch !== '$') {
      literal += ch
      i++
      continue
    }

    const rest = body.slice(i)
    const bare = BARE_STOP.exec(rest)
    if (bare) {
      addStop(Number(bare[1]))
      i += bare[0].length
      continue
    }
    if (body[i + 1] !== '{') {
      literal += '$'
      i++
      continue
    }

    const braced = BRACED_STOP.exec(rest)
    if (!braced) {
      // `${` that does not open a numbered stop stays literal.
      literal += '$'
      i++
      continue
    }

    const stop = Number(braced[1])
    let j = i + braced[0].length
    const opener = body[j]
    if (opener === '}') {
      addStop(stop)
      i = j + 1
      continue
    }
    if (opener === ':') {
      j++
      let text = ''
      let depth = 1
      let closed = false
      while (j < body.length) {
        const c = body[j]
        if (c === '\\' && body[j + 1] === '$') {
          text += '$'
          j += 2
          continue
        }
        if (c === '{') {
          depth++
          text += c
          j++
          continue
        }
        if (c === '}') {
          depth--
          if (depth === 0) {
            closed = true
            break
          }
          text += c
          j++
          continue
        }
        text += c
        j++
      }
      if (!closed) {
        literal += body.slice(i)
        break
      }
      addStop(stop, text)
      i = j + 1
      continue
    }
    if (opener === '|') {
      j++
      let raw = ''
      let closed = false
      while (j < body.length) {
        const c = body[j]
        if (c === '\\' && j + 1 < body.length) {
          raw += c + body[j + 1]
          j += 2
          continue
        }
        if (c === '|') {
          closed = body[j + 1] === '}'
          break
        }
        raw += c
        j++
      }
      if (!closed) {
        literal += body.slice(i)
        break
      }
      addStop(stop, undefined, splitChoices(raw))
      i = j + 2
      continue
    }

    // `${123` without `}`, `:` or `|`: keep the dollar literal and rescan `{`.
    literal += '$'
    i++
  }
  flush()

  return { segments, stops: tabOrder(segments).length }
}

/**
 * Renders the final text with no snippet syntax left. Stops without a value in
 * `values` keep their default text (placeholder, first choice or empty), so
 * `renderSnippetText(parsed, {})` is the text with defaults shown.
 */
export function renderSnippetText(parsed: ParsedSnippet, values: Record<number, string>): string {
  let out = ''
  for (const seg of parsed.segments) {
    out += seg.stop === undefined || values[seg.stop] === undefined ? seg.text : values[seg.stop]
  }
  return out
}

/**
 * Span of a tab position in the current text (absolute offsets), or `null` when
 * the snippet has no such stop. `current` is 1-based in tab order: positions
 * 1..n are the numbered stops and position `stops` is the final $0. `current`
 * 0 addresses the final $0 directly. Repeated stops report their first
 * occurrence; `text` is what that occurrence currently shows and `choices` is
 * set for `${N|a,b|}` stops.
 */
export function activeStop(
  parsed: ParsedSnippet,
  current: number
): { start: number; end: number; text: string; choices?: string[] } | null {
  const order = tabOrder(parsed.segments)
  if (order.length === 0) return null

  let stop: number
  if (current === 0) {
    if (!order.includes(0)) return null
    stop = 0
  } else {
    if (current < 1 || current > order.length) return null
    stop = order[current - 1]
  }

  let pos = 0
  for (const seg of parsed.segments) {
    if (seg.stop === stop) {
      const span: { start: number; end: number; text: string; choices?: string[] } = {
        start: pos,
        end: pos + seg.text.length,
        text: seg.text,
      }
      if (seg.choices) span.choices = seg.choices
      return span
    }
    pos += seg.text.length
  }
  return null
}
