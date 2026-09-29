import * as DevContextBindings from '../../bindings/adomnia/devcontext'
import type { EntityRef } from './entities/types'

export type DevEntityKind = 'module' | 'route' | 'service' | 'datasource' | 'envvar' | 'contract' | 'table' | 'topic'

export interface DevSource { detector: string; file: string; line: number }

export interface DevEntity {
  id: string
  kind: DevEntityKind
  label: string
  attrs: Record<string, string>
  sources: DevSource[]
  confidence: 'certain' | 'inferred'
}

export interface DevSnapshot {
  sessionId: string
  root: string
  version: number
  entities: DevEntity[]
  warnings: string[]
  scannedAt: string
}

export const getDevContext = (sessionId: string) => DevContextBindings.GetContext(sessionId) as Promise<DevSnapshot>
export const rescanDevContext = (sessionId: string) => DevContextBindings.RescanContext(sessionId) as Promise<DevSnapshot>
export const checkDevContextStale = (sessionId: string) => DevContextBindings.CheckStale(sessionId) as Promise<boolean>
export const readDevContextFile = (sessionId: string, relPath: string) => DevContextBindings.ReadContextFile(sessionId, relPath) as Promise<string>

export function entityRefFrom(entity: DevEntity, sessionId: string): EntityRef {
  const first = entity.sources?.[0]
  return {
    kind: entity.kind,
    id: entity.id,
    label: entity.label,
    attrs: entity.attrs ?? {},
    source: first ? { file: first.file, line: first.line } : undefined,
    sessionId,
  }
}
