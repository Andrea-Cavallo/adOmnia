import { useEffect, type RefObject } from 'react'
import { create } from 'zustand'
import type { monaco } from '@/lib/monacoSetup'
import type { GoIDEProfileReport } from '@/lib/goide-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { formatProfilePercent, formatProfileValue } from './goStudioProfiles'

/** Costo per riga del profilo aperto nel Performance Studio, mostrato nell'editor. */
export interface ProfileHeat {
  profile: string
  unit: string
  total: number
  /** relativePath → riga → valore del sample type scelto. */
  files: Map<string, Map<number, number>>
  max: number
}

export interface ProfileHeatLine {
  line: number
  level: 1 | 2 | 3 | 4
  label: string
  /** Testo a fine riga solo per le righe che contano (≥ 1% del totale), per non riempire il file. */
  inline: boolean
}

interface ProfileHeatState {
  bySession: Record<string, ProfileHeat | null>
  enabled: boolean
  publish: (sessionId: string, heat: ProfileHeat | null) => void
  setEnabled: (enabled: boolean) => void
}

export const useGoStudioProfileHeat = create<ProfileHeatState>((set) => ({
  bySession: {},
  enabled: true,
  publish: (sessionId, heat) => set((state) => ({ bySession: { ...state.bySession, [sessionId]: heat } })),
  setEnabled: (enabled) => set({ enabled }),
}))

/** Riduce il report al sample type scelto, indicizzato per file. */
export function profileHeatFrom(report: GoIDEProfileReport, sampleIndex: number): ProfileHeat {
  const files = new Map<string, Map<number, number>>()
  let max = 0
  for (const line of report.lines ?? []) {
    const value = line.value[sampleIndex] ?? 0
    if (!line.relative || value <= 0) continue
    const rows = files.get(line.relative) ?? new Map<number, number>()
    const sum = (rows.get(line.line) ?? 0) + value
    rows.set(line.line, sum)
    files.set(line.relative, rows)
    max = Math.max(max, sum)
  }
  return { profile: report.name, unit: report.sampleTypes[sampleIndex]?.unit ?? '', total: report.totals[sampleIndex] ?? 0, files, max }
}

/** Righe calde del file, con un livello 1–4 relativo alla riga più costosa del profilo. */
export function profileHeatLines(heat: ProfileHeat | null | undefined, relativePath: string): ProfileHeatLine[] {
  const rows = heat?.files.get(relativePath.replace(/\\/g, '/'))
  if (!heat || !rows || heat.max <= 0) return []
  return [...rows].sort(([a], [b]) => a - b).map(([line, value]) => {
    const ratio = value / heat.max
    const level = (ratio >= 0.5 ? 4 : ratio >= 0.2 ? 3 : ratio >= 0.05 ? 2 : 1) as ProfileHeatLine['level']
    return { line, level, label: `${formatProfileValue(value, heat.unit)} · ${formatProfilePercent(value, heat.total)}`, inline: heat.total > 0 && value / heat.total >= 0.01 }
  })
}

/** Decorazioni del costo per riga nell'editor: barra nel gutter, costo a fine riga, dettaglio in hover. */
export function useGoStudioProfileHeatDecorations(editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const heat = useGoStudioProfileHeat((state) => (state.enabled ? state.bySession[document.document.sessionId] : null))
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const lines = profileHeatLines(heat, document.document.relativePath)
    const collection = editor.createDecorationsCollection(lines.map((item) => ({
      range: { startLineNumber: item.line, startColumn: 1, endLineNumber: item.line, endColumn: 1 },
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `go-studio-heat go-studio-heat-${item.level}`,
        hoverMessage: { value: `**${item.label}** in \`${heat?.profile ?? 'profile'}\`` },
        after: item.inline ? { content: `  ${item.label}`, inlineClassName: 'go-studio-heat-label' } : undefined,
      },
    })))
    return () => collection.clear()
  }, [editorRef, heat, document.document.relativePath, mountCount])
}
