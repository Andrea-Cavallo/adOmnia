import type { GoIDEDebugVariable } from '@/lib/goide-debug-api'

export type GoStudioDebugValueKind = 'slice' | 'map' | 'channel' | 'interface' | 'context' | 'error'

export interface GoStudioDebugValueSummary {
  kind: GoStudioDebugValueKind
  label: string
  length?: number
  capacity?: number
  dynamicType?: string
}

const INTEGER_FIELD = (name: string) => new RegExp(`\\b${name}\\s*[:=]\\s*(\\d+)`, 'i')
const SLICE_TYPE = /(?:^|[\s(])\[\](?:[^\s]|$)/
const MAP_TYPE = /(?:^|[\s(])map\s*\[/
const CHANNEL_TYPE = /(?:^|[\s(])(?:<-chan|chan<-|chan)\s+/
const INTERFACE_TYPE = /\b(?:interface\s*\{|any\b)/

function numberField(value: string, name: string): number | undefined {
  const raw = value.match(INTEGER_FIELD(name))?.[1]
  return raw === undefined ? undefined : Number(raw)
}

function dynamicTypeFromDelve(value: string): string | undefined {
  if (/^<?nil>?$/i.test(value.trim())) return undefined
  const explicit = value.match(/(?:interface\s*\{\}|any)\(([^)]+)\)/i)?.[1]
  if (explicit) return explicit
  // Delve può stampare direttamente il valore concreto: main.event {ID: 7} o *pkg.Event(...).
  return value.match(/^(\*?(?:(?:[A-Za-z_][\w-]*\.)+[A-Za-z_][\w.-]*|[A-Za-z_][\w-]*))\s*(?:\{|\()/)?.[1]
}

/**
 * Classifica soltanto ciò che Delve ha già reso nel tipo/valore.
 * Non valuta reflect o Unwrap: sarebbe esecuzione di codice nel processo fermo.
 */
export function summarizeGoStudioDebugValue(variable: Pick<GoIDEDebugVariable, 'type' | 'value'>): GoStudioDebugValueSummary | null {
  const type = variable.type ?? ''
  const value = variable.value ?? ''
  if (SLICE_TYPE.test(type)) return { kind: 'slice', label: 'Slice', length: numberField(value, 'len'), capacity: numberField(value, 'cap') }
  if (MAP_TYPE.test(type)) return { kind: 'map', label: 'Map', length: numberField(value, 'len') }
  if (CHANNEL_TYPE.test(type)) return { kind: 'channel', label: 'Channel' }
  if (INTERFACE_TYPE.test(type)) {
    const dynamicType = dynamicTypeFromDelve(value)
    return { kind: 'interface', label: 'Interface', dynamicType }
  }
  if (/\bcontext\.Context\b/.test(type)) return { kind: 'context', label: 'Context' }
  if (type === 'error' || /\berror\b/.test(type)) return { kind: 'error', label: 'Error' }
  return null
}
