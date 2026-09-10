import { useCallback, useState } from 'react'
import { DEFAULT_MAX_EVENTS } from '@/lib/loginspector'
import { DEFAULT_COLUMNS, type Density, type ListColumnId } from './EventList'
import type { SavedQuery } from './FilterSidebar'

const PREFS_KEY = 'adomnia.loginspector'

export const MAX_EVENT_CHOICES = [50_000, 100_000, DEFAULT_MAX_EVENTS, 500_000]

export interface Prefs {
  columnsVersion: number
  density: Density
  wrap: boolean
  columns: ListColumnId[]
  columnWidths: Record<string, number>
  columnPresets: Record<string, { columns: ListColumnId[]; widths: Record<string, number> }>
  maxEvents: number
  savedQueries: SavedQuery[]
  maskFields: string[]
  hiddenFields: string[]
  filterWidth: number
  detailWidth: number
  /** Local repositories a stack frame can be resolved against. */
  repositoryRoots: string[]
  /** Editor invocation template; `{file}` and `{line}` are replaced. */
  editorCommand: string
}

export const DEFAULT_PREFS: Prefs = {
  columnsVersion: 3,
  density: 'compact',
  wrap: false,
  columns: DEFAULT_COLUMNS,
  columnWidths: {},
  columnPresets: {},
  maxEvents: DEFAULT_MAX_EVENTS,
  savedQueries: [],
  maskFields: [],
  hiddenFields: [],
  filterWidth: 244,
  detailWidth: 440,
  repositoryRoots: [],
  editorCommand: 'code -g {file}:{line}',
}

export function loadPrefs(): Prefs {
  try {
    const stored = localStorage.getItem(PREFS_KEY)
    if (!stored) return DEFAULT_PREFS
    const parsed = JSON.parse(stored) as Partial<Prefs>
    const configured = parsed.columns ?? DEFAULT_COLUMNS
    const columns = (parsed.columnsVersion ?? 1) < 2 && !configured.includes('source')
      ? [...configured, 'source' as const]
      : configured
    return { ...DEFAULT_PREFS, ...parsed, columns, columnsVersion: 3 }
  } catch {
    return DEFAULT_PREFS
  }
}

export type UpdatePrefs = (patch: Partial<Prefs>) => void

/** Panel preferences, mirrored to localStorage on every change. */
export function usePrefs(): [Prefs, UpdatePrefs] {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)

  const update = useCallback<UpdatePrefs>((patch) => {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* quota or private mode — preferences are a convenience, not state */
      }
      return next
    })
  }, [])

  return [prefs, update]
}
