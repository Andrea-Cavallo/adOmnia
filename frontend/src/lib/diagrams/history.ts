/**
 * Undo/redo as a bounded stack of graph snapshots. Snapshots are cheap because graphOps never mutate:
 * an unchanged node is the same object in consecutive snapshots.
 */
import type { DiagramEdge, DiagramGraph, DiagramNode } from './model'

export const HISTORY_LIMIT = 100

export interface History {
  past: DiagramGraph[]
  future: DiagramGraph[]
}

export const emptyHistory = (): History => ({ past: [], future: [] })

/** The graph without what only the canvas cares about (selection, drag state, measured size). */
export function cleanGraph(graph: DiagramGraph): DiagramGraph {
  return {
    nodes: graph.nodes.map(({ selected: _selected, dragging: _dragging, resizing: _resizing, measured: _measured, ...node }): DiagramNode => node),
    edges: graph.edges.map(({ selected: _selected, ...edge }): DiagramEdge => edge),
  }
}

/** Records the graph as it was before a change; a new change clears what could be redone. */
export function record(history: History, before: DiagramGraph): History {
  return { past: [...history.past, cleanGraph(before)].slice(-HISTORY_LIMIT), future: [] }
}

export function undo(history: History, current: DiagramGraph): { history: History; graph: DiagramGraph } | null {
  const previous = history.past[history.past.length - 1]
  if (!previous) return null
  return { history: { past: history.past.slice(0, -1), future: [cleanGraph(current), ...history.future] }, graph: previous }
}

export function redo(history: History, current: DiagramGraph): { history: History; graph: DiagramGraph } | null {
  const next = history.future[0]
  if (!next) return null
  return { history: { past: [...history.past, cleanGraph(current)].slice(-HISTORY_LIMIT), future: history.future.slice(1) }, graph: next }
}
