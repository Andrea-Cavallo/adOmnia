import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X } from 'lucide-react'
import {
  acceptAllInlineAssistant, closeInlineAssistant, generateInlineAssistant, rejectAllInlineAssistant,
  useGoStudioInlineAssistantStore,
} from './goStudioInlineAssistantSession'
import './goStudioModal.css'
import './goStudioInlineAssistant.css'

const POPUP_WIDTH = 430
const POPUP_MAX_HEIGHT = 220
const VIEWPORT_MARGIN = 12

function placement(anchor: { x: number; y: number }): { left: number; top: number } {
  const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN))
  const below = anchor.y + 4
  const top = below + POPUP_MAX_HEIGHT > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, anchor.y - POPUP_MAX_HEIGHT - 24) : below
  return { left, top }
}

/**
 * Inline Assistant (Ctrl+Enter sulla selezione): prima chiede l'istruzione, poi accompagna la
 * revisione del diff inline con Accetta tutto / Scarta tutto. Esc annulla sempre.
 */
export function GoStudioInlineAssistantPopup() {
  const state = useGoStudioInlineAssistantStore()
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const acceptRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!state.open) return
    if (state.phase === 'prompt') inputRef.current?.focus()
    if (state.phase === 'review') acceptRef.current?.focus()
  }, [state.open, state.phase])

  useEffect(() => {
    if (!state.open) return
    const onKey = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (state.phase === 'review') rejectAllInlineAssistant()
        else closeInlineAssistant()
        return
      }
      if (meta && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (state.phase === 'prompt') void generateInlineAssistant(state.instruction)
        else if (state.phase === 'review') acceptAllInlineAssistant()
      }
    }
    // Fuori dal popup, in sola digitazione, un clic chiude: la proposta non deve restare a metà.
    const onPointer = (event: MouseEvent) => {
      if (state.phase !== 'prompt') return
      if (ref.current && !ref.current.contains(event.target as Node)) closeInlineAssistant()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onPointer, true)
    }
  }, [state.open, state.phase, state.instruction])

  if (!state.open) return null
  const { left, top } = placement(state.anchor)
  const onInstructionKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void generateInlineAssistant(state.instruction)
  }
  return (
    <div ref={ref} role="dialog" aria-label="Inline Assistant" style={{ left, top, width: POPUP_WIDTH, maxHeight: POPUP_MAX_HEIGHT }} className="gs-popover flex flex-col">
      <div className="gs-popover-header">
        <span className="font-semibold text-text-1">Inline Assistant</span>
        <span className="truncate font-mono text-text-4">{state.label}</span>
        <span className="ml-auto" />
        <button type="button" title="Close · Esc" onClick={closeInlineAssistant} className="grid h-5 w-5 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={11} aria-hidden="true" /></button>
      </div>
      {state.phase === 'prompt' && (
        <div className="flex flex-col gap-2 p-3">
          <input
            ref={inputRef}
            value={state.instruction}
            onChange={(event) => useGoStudioInlineAssistantStore.getState().setInstruction(event.target.value)}
            onKeyDown={onInstructionKeyDown}
            maxLength={500}
            placeholder="e.g. add error handling"
            aria-label="Instruction for the AI"
            className="gs-input"
          />
          <div className="flex items-center gap-3 text-[10px] text-text-4">
            <span><kbd className="gs-kbd">Enter</kbd> generate</span>
            <span><kbd className="gs-kbd">Esc</kbd> cancel</span>
            <span className="ml-auto">the diff opens in the editor</span>
          </div>
        </div>
      )}
      {state.phase === 'generating' && (
        <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-2">
          <span className="go-studio-ia-spin" aria-hidden="true" />
          Rewriting the fragment…
          <span className="ml-auto text-[10px] text-text-4"><kbd className="gs-kbd">Esc</kbd> cancel</span>
        </div>
      )}
      {state.phase === 'review' && (
        <div className="flex flex-col gap-2 p-3">
          <div className="truncate text-[11px] text-text-3">{state.instruction}</div>
          <div className="text-[11px] text-text-2">
            <span className="text-success">+{state.addedLines}</span> <span className="text-danger">−{state.removedLines}</span>
            {' · '}{state.hunks} change{state.hunks === 1 ? '' : 's'} to decide
          </div>
          <div className="flex items-center gap-2">
            <button ref={acceptRef} type="button" onClick={acceptAllInlineAssistant} className="gs-btn gs-btn-primary gs-btn-sm">Accept all</button>
            <button type="button" onClick={rejectAllInlineAssistant} className="gs-btn gs-btn-ghost gs-btn-sm">Reject all</button>
            <span className="ml-auto text-[10px] text-text-4"><kbd className="gs-kbd">Ctrl+Enter</kbd> accepts all · <kbd className="gs-kbd">Esc</kbd> discards</span>
          </div>
          <div className="text-[10px] text-text-4">✓ and ✗ on each green block accept or reject that change alone.</div>
        </div>
      )}
    </div>
  )
}
