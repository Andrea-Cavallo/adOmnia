import { create } from 'zustand'
import type { GoIDEBreakpoint } from '@/lib/goide-debug-api'

/** Stesse forme accettate da Delve: "3" (solo al terzo passaggio), ">= 5", "% 10"… */
const HIT_CONDITION = /^(>=|<=|==|!=|>|<|%)?\s*[0-9]+$/

/** Campi modificabili di un breakpoint (riga o funzione), come li mostra il form. */
export interface BreakpointDraft {
  enabled: boolean
  condition: string
  hitCondition: string
  /** true: logpoint, stampa il messaggio senza fermarsi. */
  log: boolean
  logMessage: string
}

export function hitConditionError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || HIT_CONDITION.test(trimmed)) return null
  return 'Use a number (stops only on that hit) or >= N, == N, % N'
}

export function draftFrom(breakpoint: Partial<GoIDEBreakpoint> | null | undefined): BreakpointDraft {
  return {
    enabled: !breakpoint?.disabled,
    condition: breakpoint?.condition ?? '',
    hitCondition: breakpoint?.hitCondition ?? '',
    log: !!breakpoint?.logMessage,
    logMessage: breakpoint?.logMessage ?? '',
  }
}

/** Opzioni del breakpoint dal form; senza messaggio il logpoint torna un breakpoint normale. */
export function optionsFrom(draft: BreakpointDraft): Omit<GoIDEBreakpoint, 'line'> {
  const options: Omit<GoIDEBreakpoint, 'line'> = {}
  if (!draft.enabled) options.disabled = true
  if (draft.condition.trim()) options.condition = draft.condition.trim()
  if (draft.hitCondition.trim()) options.hitCondition = draft.hitCondition.trim()
  if (draft.log && draft.logMessage.trim()) options.logMessage = draft.logMessage.trim()
  return options
}

/** Riassunto di una riga per elenchi e tooltip: "if x > 1 · hit 3 · log "…"". */
export function breakpointSummary(breakpoint: Partial<GoIDEBreakpoint>): string {
  const parts: string[] = []
  if (breakpoint.condition) parts.push(`if ${breakpoint.condition}`)
  if (breakpoint.hitCondition) parts.push(`hit ${breakpoint.hitCondition}`)
  if (breakpoint.logMessage) parts.push(`log "${breakpoint.logMessage}"`)
  if (breakpoint.disabled) parts.push('disabled')
  return parts.join(' · ')
}

export interface BreakpointPopoverTarget {
  sessionId: string
  relativePath: string
  line: number
  x: number
  y: number
}

interface BreakpointUiState {
  popover: BreakpointPopoverTarget | null
  dialogOpen: boolean
  openPopover: (target: BreakpointPopoverTarget) => void
  closePopover: () => void
  setDialogOpen: (open: boolean) => void
}

/** Popover di modifica sul gutter e dialog Breakpoints (Ctrl+Shift+F8). */
export const useGoStudioBreakpointUi = create<BreakpointUiState>((set) => ({
  popover: null,
  dialogOpen: false,
  openPopover: (popover) => set({ popover }),
  closePopover: () => set({ popover: null }),
  setDialogOpen: (dialogOpen) => set({ dialogOpen, popover: null }),
}))
