import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorLocation, GoIDEQuickDefinition } from '@/lib/goide-lsp-api'
import { useGoIDELspStore, type GoIDECaretPopup } from '@/stores/goideLsp'
import { navigateToLocation } from './goStudioLanguageFeatures'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import './goStudioModal.css'
import { groupUsagesByKind } from './goStudioUsages'

const POPUP_WIDTH = 560
const POPUP_MAX_HEIGHT = 320
const VIEWPORT_MARGIN = 12

function placement(anchor: { x: number; y: number }): { left: number; top: number } {
  const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN))
  const below = anchor.y + 4
  const top = below + POPUP_MAX_HEIGHT > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, anchor.y - POPUP_MAX_HEIGHT - 24) : below
  return { left, top }
}

function closePopup(): void {
  useGoIDELspStore.getState().showCaretPopup(null)
  activeGoStudioEditor()?.focus()
}

function DefinitionBody({ result }: { result: GoIDEQuickDefinition }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void monaco.editor.colorize(result.code, 'go', { tabSize: 4 }).then((colored) => { if (!cancelled) setHtml(colored) })
    return () => { cancelled = true }
  }, [result.code])
  const lines = result.code.split('\n').length
  return (
    <div className="flex min-h-0 overflow-auto bg-surface-0 font-mono text-[11px] leading-[18px]">
      <div aria-hidden="true" className="select-none border-r border-border-1 px-2 py-2 text-right text-text-4">
        {Array.from({ length: lines }, (_, index) => <div key={index}>{result.startLine + index}</div>)}
      </div>
      {/* colorize di Monaco produce HTML con il testo già escapato. */}
      {html === null
        ? <pre className="flex-1 whitespace-pre px-3 py-2 text-text-1">{result.code}</pre>
        : <div className="flex-1 whitespace-pre px-3 py-2" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}

function UsagesBody({ locations, onPick, groupLabel }: { locations: GoIDEEditorLocation[]; onPick: (location: GoIDEEditorLocation) => void; groupLabel?: string }) {
  const groups = useMemo(() => groupUsagesByKind(locations), [locations])
  const ordered = useMemo(() => groups.flatMap((group) => group.files.flatMap(([, items]) => items)), [groups])
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.focus() }, [])
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(ordered.length - 1, value + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
    if (event.key === 'Enter' && ordered[selected]) { event.preventDefault(); onPick(ordered[selected]) }
  }
  let index = -1
  return (
    <div ref={listRef} role="listbox" tabIndex={0} aria-label="Usages" onKeyDown={onKeyDown} className="min-h-0 overflow-auto py-1 text-[11px] outline-none">
      {groups.map((group) => (
        <div key={group.kind}>
          <div className="px-3 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wide text-text-4">{group.kind === 'other' && groupLabel ? groupLabel : group.label} · {group.count}</div>
          {group.files.flatMap(([file, items]) => items.map((location) => {
            index += 1
            const position = index
            return (
              <button
                key={`${file}:${location.range.startLine}:${location.range.startColumn}`}
                type="button"
                role="option"
                aria-selected={position === selected}
                onMouseEnter={() => setSelected(position)}
                onClick={() => onPick(location)}
                className={`flex h-6 w-full items-center gap-2 px-3 text-left ${position === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}
              >
                <span className="w-40 shrink-0 truncate text-[10px] text-text-3">{file}:{location.range.startLine}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{location.preview}</span>
              </button>
            )
          }))}
        </div>
      ))}
    </div>
  )
}

/** Popup accanto al cursore per Quick Definition e Show Usages; Esc o clic fuori lo chiudono. */
export function GoStudioCaretPopup() {
  const popup = useGoIDELspStore((state) => state.caretPopup)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popup) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closePopup() } }
    const onPointer = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) closePopup() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onPointer, true)
    }
  }, [popup])
  if (!popup) return null
  const { left, top } = placement(popup.anchor)
  const pick = (location: GoIDEEditorLocation) => { closePopup(); navigateToLocation(location) }
  return (
    <div ref={ref} role="dialog" aria-label={titleFor(popup)} style={{ left, top, width: POPUP_WIDTH, maxHeight: POPUP_MAX_HEIGHT }} className="gs-popover flex flex-col">
      <div className="gs-popover-header">
        <span className="font-semibold text-text-1">{titleFor(popup)}</span>
        {popup.kind === 'definition' && <span className="truncate font-mono text-text-4">{locationLabel(popup.result.location)}</span>}
        {popup.kind === 'usages' && <span className="text-text-4">{popup.locations.length} result{popup.locations.length === 1 ? '' : 's'}</span>}
        <span className="ml-auto" />
        <button type="button" title={popup.kind === 'definition' ? 'Jump to source' : 'Open in Usages tool window'} onClick={() => openFull(popup)} className="grid h-5 w-5 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><ExternalLink size={11} aria-hidden="true" /></button>
        <button type="button" title="Close · Esc" onClick={closePopup} className="grid h-5 w-5 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={11} aria-hidden="true" /></button>
      </div>
      {popup.kind === 'definition' ? <DefinitionBody result={popup.result} /> : <UsagesBody locations={popup.locations} onPick={pick} groupLabel={popup.groupLabel} />}
      {popup.kind === 'definition' && popup.result.truncated && <div className="border-t border-border-1 px-3 py-1 text-[9px] text-text-4">Declaration truncated · jump to source for the full text</div>}
    </div>
  )
}

function titleFor(popup: GoIDECaretPopup): string {
  return popup.kind === 'definition' ? 'Quick Definition' : popup.title
}

function locationLabel(location: GoIDEEditorLocation): string {
  return `${location.relativePath || location.path}:${location.range.startLine}`
}

function openFull(popup: GoIDECaretPopup): void {
  closePopup()
  if (popup.kind === 'definition') return navigateToLocation(popup.result.location)
  const lsp = useGoIDELspStore.getState()
  lsp.showReferences(popup.sessionId, { title: popup.title, locations: popup.locations })
}
