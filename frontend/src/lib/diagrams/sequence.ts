/**
 * UML sequence diagrams from text, in the familiar Mermaid `sequenceDiagram` syntax:
 *
 *   participant API as Order API      actor User
 *   User->>API: place order            sync call (filled arrow)
 *   API-)Queue: publish                async message (open arrow)
 *   API-->>User: 201 Created           reply (dashed, open arrow)
 *   loop / alt / opt <guard> … else <guard> … end
 *   autonumber
 *
 * The result is a normal, fully editable graph: lifelines with a connection point on every row,
 * messages attached to those rows (so they stay horizontal when a lifeline moves), activation bars
 * as children of their lifeline and combined fragments framing the rows they cover.
 */
import { createEdge, createNode } from './graphOps'
import { SEQ_BAR_HALF, SEQ_FIRST_ROW, SEQ_ROW } from './geometry'
import type { DiagramEdge, DiagramGraph, DiagramNode } from './model'

export type MessageKind = 'sync' | 'async' | 'reply'

export interface SequenceParticipant { key: string; label: string; actor: boolean }
export type SequenceStep =
  | { type: 'message'; from: string; to: string; label: string; kind: MessageKind }
  | { type: 'open'; operator: 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break'; guard: string }
  | { type: 'else'; guard: string }
  /** Mermaid `rect <color>`: a tinted band behind its messages, which take the color too. */
  | { type: 'rect'; color: string }
  | { type: 'end' }

export interface SequenceSpec {
  participants: SequenceParticipant[]
  steps: SequenceStep[]
}

const COLUMN = 180
const LIFELINE_WIDTH = 124
const FRAGMENT_MARGIN = 26
const BAND_MARGIN = 14
const last = <T,>(list: readonly T[]): T | undefined => list[list.length - 1]
const OPERATORS = new Set(['loop', 'alt', 'opt', 'par', 'critical', 'break'])
const ARROWS: ReadonlyArray<[string, MessageKind]> = [['-->>', 'reply'], ['->>', 'sync'], ['--)', 'async'], ['-)', 'async'], ['-->', 'reply'], ['->', 'sync']]
const MESSAGE = /^(.+?)\s*(-->>|->>|--\)|-\)|-->|->)\s*([+-]?)(.+?)\s*:\s*(.*)$/

/** True when the text looks like a sequence diagram rather than a flowchart or prose. */
export const isSequenceText = (text: string) => /^\s*sequenceDiagram\b/m.test(text) || /^\s*\S+?\s*-?->>\s*\S+?\s*:/m.test(text)

export function parseSequence(text: string): SequenceSpec {
  const participants: SequenceParticipant[] = []
  const steps: SequenceStep[] = []
  let numbered = false
  let counter = 0
  const ensure = (key: string, label = key, actor = false) => {
    const existing = participants.find((participant) => participant.key === key)
    if (existing) return
    participants.push({ key, label, actor })
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/%%.*$/, '').trim()
    if (!line || line === 'sequenceDiagram' || line.startsWith('```')) continue
    if (line === 'autonumber') { numbered = true; continue }
    const declared = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i.exec(line)
    if (declared) { ensure(declared[2], declared[3]?.trim() || declared[2], declared[1].toLowerCase() === 'actor'); continue }
    const word = line.split(/\s+/)[0].toLowerCase()
    if (OPERATORS.has(word)) { steps.push({ type: 'open', operator: word as 'loop', guard: line.slice(word.length).trim() }); continue }
    if (word === 'else' || word === 'and') { steps.push({ type: 'else', guard: line.slice(word.length).trim() }); continue }
    if (word === 'end') { steps.push({ type: 'end' }); continue }
    if (word === 'rect') { steps.push({ type: 'rect', color: line.slice(4).trim() }); continue }
    const message = MESSAGE.exec(line)
    if (!message) continue
    const kind = ARROWS.find(([arrow]) => arrow === message[2])?.[1] ?? 'sync'
    const from = message[1].trim()
    const to = message[4].trim()
    ensure(from)
    ensure(to)
    counter += 1
    steps.push({ type: 'message', from, to, kind, label: numbered ? `${counter}. ${message[5].trim()}` : message[5].trim() })
  }
  return { participants, steps }
}

interface PlacedMessage { row: number; from: string; to: string; label: string; kind: MessageKind; self: boolean; color: string }
interface PlacedFragment { operator: string; guard: string; top: number; bottom: number; dividers: Array<{ row: number; guard: string }>; members: Set<string> }
interface PlacedBand { color: string; top: number; bottom: number; members: Set<string> }

/** Rows of every message, fragment and colored band; a self-message takes two rows (out and back). */
function placeSteps(steps: SequenceStep[]) {
  const messages: PlacedMessage[] = []
  const fragments: PlacedFragment[] = []
  const bands: PlacedBand[] = []
  // One stack for every block `end` closes, fragments and bands alike.
  const open: Array<{ fragment: PlacedFragment } | { band: PlacedBand }> = []
  const openFragments = () => open.flatMap((block) => ('fragment' in block ? [block.fragment] : []))
  const openBands = () => open.flatMap((block) => ('band' in block ? [block.band] : []))
  let row = 0
  for (const step of steps) {
    if (step.type === 'message') {
      const self = step.from === step.to
      const color = last(openBands())?.color ?? ''
      messages.push({ row, from: step.from, to: step.to, label: step.label, kind: step.kind, self, color })
      for (const block of [...openFragments(), ...openBands()]) { block.members.add(step.from); block.members.add(step.to) }
      row += self ? 2 : 1
      for (const band of openBands()) band.bottom = row - 1
    } else if (step.type === 'open') {
      const fragment: PlacedFragment = { operator: step.operator, guard: step.guard, top: row, bottom: row, dividers: [], members: new Set() }
      open.push({ fragment })
      fragments.push(fragment)
      row += 1
    } else if (step.type === 'rect') {
      const band: PlacedBand = { color: step.color, top: row, bottom: row, members: new Set() }
      open.push({ band })
      bands.push(band)
    } else if (step.type === 'else') {
      last(openFragments())?.dividers.push({ row, guard: step.guard })
      row += 1
    } else {
      const block = open.pop()
      if (block && 'fragment' in block) block.fragment.bottom = row - 1
    }
  }
  for (const fragment of openFragments()) fragment.bottom = row - 1
  return { messages, fragments, bands, rows: Math.max(row, 1) }
}

const NAMED: Record<string, [number, number, number]> = {
  green: [63, 185, 107], red: [214, 90, 90], amber: [212, 160, 58], orange: [230, 140, 50], blue: [76, 143, 214],
  violet: [155, 122, 216], purple: [155, 122, 216], teal: [79, 179, 179], graphite: [120, 126, 136], gray: [120, 126, 136], grey: [120, 126, 136],
}

/** A band color (`#hex`, `rgb(…)`/`rgba(…)` as Mermaid writes it, or a palette name) as RGB. */
export function bandRgb(color: string): [number, number, number] | null {
  const value = color.trim().toLowerCase()
  if (NAMED[value]) return NAMED[value]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]
    return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as [number, number, number]
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

const rgbText = ([r, g, b]: [number, number, number], alpha = 1) => (alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`)

/** Rows each participant is busy on: it sends or receives there, or waits between a call and its reply. */
function activeRows(messages: PlacedMessage[]): Map<string, Set<number>> {
  const active = new Map<string, Set<number>>()
  const mark = (key: string, from: number, to = from) => {
    const rows = active.get(key) ?? new Set<number>()
    for (let row = from; row <= to; row++) rows.add(row)
    active.set(key, rows)
  }
  messages.forEach((message, index) => {
    mark(message.from, message.row, message.self ? message.row + 1 : message.row)
    mark(message.to, message.row, message.self ? message.row + 1 : message.row)
    if (message.kind !== 'sync' || message.self) return
    const reply = messages.slice(index + 1).find((later) => later.kind === 'reply' && later.from === message.to && later.to === message.from)
    if (reply) mark(message.to, message.row, reply.row)
  })
  return active
}

/** Consecutive rows as [first, last] ranges. */
function ranges(rows: Set<number>): Array<[number, number]> {
  const sorted = [...rows].sort((a, b) => a - b)
  const result: Array<[number, number]> = []
  for (const row of sorted) {
    const last = result[result.length - 1] as [number, number] | undefined
    if (last && row === last[1] + 1) last[1] = row
    else result.push([row, row])
  }
  return result
}

const rowY = (row: number) => SEQ_FIRST_ROW + row * SEQ_ROW

export function sequenceGraph(spec: SequenceSpec): DiagramGraph {
  const { messages, fragments, bands, rows } = placeSteps(spec.steps)
  const height = SEQ_FIRST_ROW + (rows - 1) * SEQ_ROW + 48
  const column = new Map(spec.participants.map((participant, index) => [participant.key, index]))
  const lifelines = new Map<string, DiagramNode>()
  spec.participants.forEach((participant, index) => {
    const node = createNode(participant.actor ? 'seq-actor' : 'seq-lifeline', { x: index * COLUMN, y: 0 }, { label: participant.label })
    lifelines.set(participant.key, { ...node, width: LIFELINE_WIDTH, height })
  })

  const bars: DiagramNode[] = []
  for (const [key, set] of activeRows(messages)) {
    const lifeline = lifelines.get(key)
    if (!lifeline) continue
    for (const [first, last] of ranges(set)) {
      const top = rowY(first) - 14
      const bar = createNode('seq-activation', { x: LIFELINE_WIDTH / 2 - SEQ_BAR_HALF, y: top }, {})
      bars.push({ ...bar, parentId: lifeline.id, height: rowY(last) + 14 - top, width: SEQ_BAR_HALF * 2, zIndex: 1 })
    }
  }

  const edges: DiagramEdge[] = messages.flatMap((message) => {
    const source = lifelines.get(message.from)
    const target = lifelines.get(message.to)
    if (!source || !target) return []
    const rightward = (column.get(message.to) ?? 0) >= (column.get(message.from) ?? 0)
    const handles = message.self
      ? { sourceHandle: `R${message.row}`, targetHandle: `R${message.row + 1}` }
      : rightward ? { sourceHandle: `R${message.row}`, targetHandle: `L${message.row}` } : { sourceHandle: `L${message.row}`, targetHandle: `R${message.row}` }
    const rgb = bandRgb(message.color)
    return [createEdge({ source: source.id, target: target.id, ...handles }, message.self ? 'orthogonal' : 'straight', {
      label: message.label,
      dashed: message.kind === 'reply',
      arrowEnd: message.kind === 'sync' ? 'arrow' : 'open',
      ...(rgb ? { color: rgbText(rgb), thickness: 1.8 } : {}),
    })]
  })

  /** Left and right edge of the columns a block covers (all of them when it has no message). */
  const span = (members: Set<string>, margin: number) => {
    const columns = [...(members.size ? members : new Set(spec.participants.map((participant) => participant.key)))].map((key) => column.get(key) ?? 0)
    return { left: Math.min(...columns) * COLUMN - margin, right: Math.max(...columns) * COLUMN + LIFELINE_WIDTH + margin }
  }

  const tints = bands.flatMap((band) => {
    const rgb = bandRgb(band.color)
    if (!rgb) return []
    const { left, right } = span(band.members, BAND_MARGIN)
    const top = rowY(band.top) - 24
    const node = createNode('seq-band', { x: left, y: top }, {
      label: '',
      style: { fill: rgbText(rgb, 0.1), stroke: rgbText(rgb, 0.45), strokeWidth: 1, radius: 0, textColor: '', fontSize: 11, dashed: false },
    })
    return [{ ...node, width: right - left, height: rowY(Math.max(band.bottom, band.top)) + 16 - top, zIndex: -1 }]
  })

  const frames = fragments.map((fragment) => {
    const { left, right } = span(fragment.members, FRAGMENT_MARGIN)
    const top = rowY(fragment.top) - 16
    const bottom = rowY(Math.max(fragment.bottom, fragment.top)) + 22
    const shape = fragment.operator === 'alt' ? 'seq-alt' : fragment.operator === 'loop' ? 'seq-loop' : 'seq-opt'
    const node = createNode(shape, { x: left, y: top }, {
      label: fragment.operator,
      subtitle: fragment.guard ? `[${fragment.guard.replace(/^\[|\]$/g, '')}]` : '',
      dividers: fragment.dividers.map((divider) => ({ y: rowY(divider.row) - 16 - top, label: divider.guard ? `[${divider.guard.replace(/^\[|\]$/g, '')}]` : '' })),
    })
    return { ...node, width: right - left, height: bottom - top, zIndex: 2 }
  })

  // Lifelines before their bars (React Flow needs a parent first); fragments last, drawn over but click-through.
  // Colored bands sit behind everything (click-through, like fragments).
  return { nodes: [...tints, ...lifelines.values(), ...bars, ...frames], edges }
}

export const sequenceFromText = (text: string): DiagramGraph => sequenceGraph(parseSequence(text))
