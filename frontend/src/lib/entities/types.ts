export type EntityKind = 'module' | 'route' | 'service' | 'datasource' | 'envvar' | 'contract' | 'table' | 'topic' | 'symbol'

/** A thing any panel can open: a route, a table, a topic, a Go symbol… */
export interface EntityRef {
  kind: EntityKind
  id: string
  label: string
  attrs: Record<string, string>
  source?: { file: string; line: number }
  /** gO session the entity belongs to; source paths are relative to its root. */
  sessionId?: string
}

export interface Opener {
  intent: string
  title: string
  isDefault?: boolean
  available?: (ref: EntityRef) => boolean
  run: (ref: EntityRef) => void | Promise<void>
}
