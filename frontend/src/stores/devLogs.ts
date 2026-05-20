import { create } from 'zustand'

export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'
export type LogSource = 'frontend' | 'backend'

export interface BackendDevLogEntry {
  i: number
  ts: string
  source?: string
  func?: string
  level: string
  msg: string
  data?: Record<string, unknown>
}

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  source: LogSource
  scope?: string
  message: string
  data?: Record<string, unknown>
}

interface DevLogsState {
  entries: LogEntry[]
  addEntry: (level: LogLevel, message: string, source?: LogSource, scope?: string, data?: Record<string, unknown>) => void
  mergeBackendEntries: (entries: BackendDevLogEntry[]) => void
  clear: () => void
}

let nextId = 0

function normalizeLevel(level: string): LogLevel {
  const value = level.toLowerCase()
  if (value === 'warning') return 'warn'
  if (value === 'err' || value === 'fatal') return 'error'
  if (value === 'warn' || value === 'error' || value === 'info' || value === 'debug' || value === 'log') return value
  return 'log'
}

export const useDevLogsStore = create<DevLogsState>((set) => ({
  entries: [],

  addEntry: (level, message, source = 'frontend', scope, data) => {
    const entry: LogEntry = {
      id: `${source}-${nextId++}`,
      timestamp: Date.now(),
      level,
      source,
      scope,
      message,
      data,
    }
    set((s) => ({
      entries: s.entries.length > 2000 ? [...s.entries.slice(-1000), entry] : [...s.entries, entry],
    }))
  },

  mergeBackendEntries: (backendEntries) => {
    set((s) => {
      const known = new Set(s.entries.map((entry) => entry.id))
      const next = [...s.entries]
      for (const backendEntry of backendEntries) {
        const id = `${backendEntry.source || 'backend'}-${backendEntry.i}`
        if (known.has(id)) continue
        const timestamp = Number.isNaN(Date.parse(backendEntry.ts)) ? Date.now() : Date.parse(backendEntry.ts)
        const source = (backendEntry.source === 'frontend' ? 'frontend' : 'backend')
        if (source === 'frontend' && s.entries.some((entry) =>
          entry.source === 'frontend'
          && entry.message === backendEntry.msg
          && Math.abs(entry.timestamp - timestamp) < 2000
        )) {
          known.add(id)
          continue
        }
        known.add(id)
        next.push({
          id,
          timestamp,
          level: normalizeLevel(backendEntry.level),
          source,
          scope: backendEntry.func,
          message: backendEntry.msg,
          data: backendEntry.data,
        })
      }
      next.sort((a, b) => a.timestamp - b.timestamp)
      return { entries: next.length > 2000 ? next.slice(-2000) : next }
    })
  },

  clear: () => set({ entries: [] }),
}))
