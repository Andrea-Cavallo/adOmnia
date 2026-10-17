import { validAccent } from './accentPalette'

export const JSON_COLOR_KEYS = ['key', 'string', 'number', 'array', 'object', 'bool', 'null'] as const
export type JsonColorKey = typeof JSON_COLOR_KEYS[number]
export type JsonPalette = Partial<Record<JsonColorKey, string>>
export type JsonColors = Partial<Record<'dark' | 'light', JsonPalette>>

export function normalizeJsonColors(value: unknown): JsonColors {
  const result: JsonColors = {}
  if (!value || typeof value !== 'object') return result
  for (const mode of ['dark', 'light'] as const) {
    const palette = (value as JsonColors)[mode]
    if (!palette || typeof palette !== 'object') continue
    result[mode] = Object.fromEntries(JSON_COLOR_KEYS.flatMap(key => validAccent(palette[key]) ? [[key, palette[key]]] : []))
  }
  return result
}

export function jsonColorTokens(palette: JsonPalette = {}): Record<string, string> {
  return Object.fromEntries(JSON_COLOR_KEYS.flatMap(key => validAccent(palette[key]) ? [[`json-${key}`, palette[key]!]] : []))
}
