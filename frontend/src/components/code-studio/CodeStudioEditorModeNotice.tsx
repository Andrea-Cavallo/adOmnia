import type { RefObject } from 'react'
import type { CodeStudioEditorMode } from './codeStudioEditorModes'
import type { CodeStudioVimMode } from '@/stores/codeStudioWhenContext'

interface Props {
  mode: CodeStudioEditorMode
  vimMode: CodeStudioVimMode | null
  statusRef: RefObject<HTMLDivElement | null>
  onStandard: () => void
}

/** Modal editing must always explain why printable keys do not insert text. */
export function CodeStudioEditorModeNotice({ mode, vimMode, statusRef, onStandard }: Props) {
  return <div className={mode === 'default' ? 'hidden' : 'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-1 bg-surface-1 px-3 py-1 text-[11px] text-text-3'}>
    <span role="status" aria-live="polite">{mode === 'vim'
      ? `Vim · ${vimMode === 'insert' ? 'Insert — Esc returns to navigation' : vimMode === 'visual' ? 'Visual selection — Esc returns to navigation' : 'Navigation — press i to type'}`
      : 'Emacs keyboard mode'}</span>
    <button type="button" className="ml-auto rounded px-2 py-1 text-text-1 hover:bg-surface-3 focus-visible:outline focus-visible:outline-accent" onClick={onStandard}>Use standard editing</button>
    <div ref={statusRef} aria-label="Editor mode command status" className="w-full font-mono text-[10px] text-text-4" />
  </div>
}
