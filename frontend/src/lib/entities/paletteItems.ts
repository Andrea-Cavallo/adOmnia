import { entityRefFrom, type DevSnapshot } from '../devcontext-api'
import type { GoIDEWorkspaceSymbol } from '../goide-lsp-api'
import type { EntityKind, EntityRef } from './types'

export interface EntityPaletteItem {
  id: string
  title: string
  subtitle: string
  keywords: string
  ref: EntityRef
}

export const KIND_LABELS: Record<EntityKind, string> = {
  module: 'Module', route: 'Route', service: 'Service', datasource: 'Datasource', envvar: 'Env var',
  contract: 'Contract', table: 'Table', topic: 'Topic', grpc: 'gRPC service', websocket: 'WebSocket', symbol: 'Symbol',
}

export function entityPaletteItems(snapshot: DevSnapshot): EntityPaletteItem[] {
  return (snapshot.entities ?? []).map((entity) => {
    const ref = entityRefFrom(entity, snapshot.sessionId)
    const where = ref.source ? ` · ${ref.source.file}:${ref.source.line}` : ''
    const confidence = entity.confidence === 'inferred' ? ' · inferred' : ''
    return {
      id: `entity:${entity.id}`,
      title: entity.label,
      subtitle: `${KIND_LABELS[entity.kind]}${where}${confidence}`,
      keywords: `${entity.kind} ${KIND_LABELS[entity.kind]} ${Object.values(ref.attrs).join(' ')}`,
      ref,
    }
  })
}

export function symbolPaletteItems(symbols: GoIDEWorkspaceSymbol[], sessionId: string): EntityPaletteItem[] {
  return symbols
    .filter((symbol) => !symbol.location.external && symbol.location.relativePath)
    .map((symbol) => {
      const file = symbol.location.relativePath ?? ''
      const line = symbol.location.range.startLine
      return {
        id: `symbol:${file}:${line}:${symbol.name}`,
        title: symbol.name,
        subtitle: `Symbol · ${file}:${line}`,
        keywords: `symbol func type ${symbol.container ?? ''}`,
        ref: { kind: 'symbol', id: `symbol:${file}:${line}:${symbol.name}`, label: symbol.name, attrs: {}, source: { file, line }, sessionId },
      }
    })
}
