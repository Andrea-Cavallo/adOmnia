import { useMemo, useRef, useState } from 'react'
import { ExternalLink, Search, Settings2, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { EDITOR_FONT_SIZE, useGoIDELspStore, type GoIDEEditorPreferences } from '@/stores/goideLsp'
import type { GoIDELanguageServerSettings } from '@/lib/goide-lsp-api'
import type { GoStudioCommandId } from './goStudioCommands'

type Section = 'Editor' | 'Save actions' | 'Language server' | 'Performance' | 'Keymap & tools'

interface ToggleSetting {
  section: Section
  label: string
  hint: string
  kind: 'toggle'
  pref?: keyof GoIDEEditorPreferences
  server?: keyof GoIDELanguageServerSettings
}

interface SelectSetting {
  section: Section
  label: string
  hint: string
  kind: 'select'
  pref: 'resourceMode' | 'editorMode'
  options: Array<{ value: string; label: string }>
}

interface LinkSetting {
  section: Section
  label: string
  hint: string
  kind: 'link'
  command: GoStudioCommandId
}

type Setting = ToggleSetting | SelectSetting | LinkSetting | { section: Section; label: string; hint: string; kind: 'fontSize' }

const SETTINGS: Setting[] = [
  { section: 'Editor', label: 'Font size', hint: 'Editor font size; Ctrl+= / Ctrl+- also zoom.', kind: 'fontSize' },
  { section: 'Editor', label: 'Font ligatures', hint: 'Combine operators such as := and != into ligatures.', kind: 'toggle', pref: 'fontLigatures' },
  { section: 'Editor', label: 'Sticky scroll', hint: 'Keep function and block headers at the top while scrolling.', kind: 'toggle', pref: 'stickyScroll' },
  { section: 'Editor', label: 'Minimap', hint: 'Overview of the file at the right edge.', kind: 'toggle', pref: 'minimap' },
  { section: 'Editor', label: 'Preview tab', hint: 'A single click in Project opens a preview tab that the next click replaces.', kind: 'toggle', pref: 'previewTab' },
  { section: 'Editor', label: 'Keyboard emulation', hint: 'Vim or Emacs keys in the editor.', kind: 'select', pref: 'editorMode', options: [{ value: 'default', label: 'Default' }, { value: 'vim', label: 'Vim' }, { value: 'emacs', label: 'Emacs' }] },
  { section: 'Editor', label: 'Semantic highlighting', hint: 'Colors from gopls for parameters, variables and types.', kind: 'toggle', pref: 'semanticHighlighting' },
  { section: 'Editor', label: 'Inlay hints', hint: 'Parameter names for literals and inferred type parameters.', kind: 'toggle', pref: 'inlayHints' },
  { section: 'Editor', label: 'Type hints', hint: 'Inferred types of := and range, composite literal types, constant values.', kind: 'toggle', pref: 'typeHints' },
  { section: 'Save actions', label: 'Format on save', hint: 'gofmt (or gofumpt) through gopls.', kind: 'toggle', pref: 'formatOnSave' },
  { section: 'Save actions', label: 'Optimize imports on save', hint: 'Add missing and remove unused imports.', kind: 'toggle', pref: 'organizeImportsOnSave' },
  { section: 'Save actions', label: 'Run linter on save', hint: 'golangci-lint or staticcheck, when installed.', kind: 'toggle', pref: 'lintOnSave' },
  { section: 'Save actions', label: 'Trim trailing whitespace', hint: 'For non-Go files; Go files are already formatted.', kind: 'toggle', pref: 'trimTrailingWhitespace' },
  { section: 'Save actions', label: 'Auto save', hint: 'Save modified files when the editor loses focus.', kind: 'toggle', pref: 'autoSave' },
  { section: 'Language server', label: 'gofumpt style', hint: 'Stricter formatting rules (restarts gopls).', kind: 'toggle', server: 'gofumpt' },
  { section: 'Language server', label: 'staticcheck analyzers', hint: 'Extra analyzers inside gopls (restarts gopls).', kind: 'toggle', server: 'staticcheck' },
  { section: 'Language server', label: 'Vulnerability diagnostics', hint: 'gopls vulncheck on go.mod; needs network access to vuln.go.dev (restarts gopls).', kind: 'toggle', server: 'vulncheck' },
  { section: 'Language server', label: 'Completion placeholders', hint: 'Insert parameter placeholders when completing a call (restarts gopls).', kind: 'toggle', server: 'placeholders' },
  { section: 'Performance', label: 'Low-resource mode', hint: 'Pause semantic colors, inlay hints, sticky scroll, minimap and lint on save.', kind: 'select', pref: 'resourceMode', options: [{ value: 'normal', label: 'Off' }, { value: 'low', label: 'Always' }, { value: 'auto', label: 'Only on battery' }] },
  { section: 'Keymap & tools', label: 'Keyboard shortcuts', hint: 'GoLand or VS Code keymap, custom shortcuts and conflicts.', kind: 'link', command: 'help.shortcuts' },
  { section: 'Keymap & tools', label: 'Go toolchains', hint: 'Go SDKs for this project, GOPROXY, GOPRIVATE and environment.', kind: 'link', command: 'go.toolchains' },
  { section: 'Keymap & tools', label: 'Tool paths', hint: 'gopls, linter, Delve and make binaries.', kind: 'link', command: 'go.toolPaths' },
  { section: 'Keymap & tools', label: 'GitHub Copilot', hint: 'Accounts, proxy and ignored paths.', kind: 'link', command: 'tools.copilot' },
]

const SECTIONS: Section[] = ['Editor', 'Save actions', 'Language server', 'Performance', 'Keymap & tools']

interface GoStudioSettingsDialogProps {
  open: boolean
  sessionId: string | null
  onCommand: (id: GoStudioCommandId) => void
  onClose: () => void
}

/** Settings di Go Studio in un unico posto (Ctrl+Alt+S, come GoLand), con ricerca. */
export function GoStudioSettingsDialog({ open, sessionId, onCommand, onClose }: GoStudioSettingsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  const preferences = useGoIDELspStore((state) => state.preferences)
  const settings = useGoIDELspStore((state) => state.settings)
  const [section, setSection] = useState<Section>('Editor')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => SETTINGS.filter((item) => (needle ? `${item.label} ${item.hint} ${item.section}`.toLowerCase().includes(needle) : item.section === section)), [needle, section])
  if (!open) return null

  const lsp = useGoIDELspStore.getState()
  const control = (item: Setting) => {
    if (item.kind === 'fontSize') {
      return (
        <input type="number" min={EDITOR_FONT_SIZE.min} max={EDITOR_FONT_SIZE.max} value={preferences.fontSize}
          onChange={(event) => lsp.updatePreferences({ fontSize: Math.min(EDITOR_FONT_SIZE.max, Math.max(EDITOR_FONT_SIZE.min, Number(event.target.value) || EDITOR_FONT_SIZE.default)) })}
          aria-label={item.label} className="h-6 w-16 rounded border border-border-1 bg-surface-0 px-1.5 text-[11px] text-text-1" />
      )
    }
    if (item.kind === 'select') {
      return (
        <select value={String(preferences[item.pref])} onChange={(event) => lsp.updatePreferences({ [item.pref]: event.target.value } as Partial<GoIDEEditorPreferences>)} aria-label={item.label} className="h-6 rounded border border-border-1 bg-surface-0 px-1.5 text-[11px] text-text-1">
          {item.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )
    }
    if (item.kind === 'link') {
      return <button type="button" onClick={() => { onClose(); onCommand(item.command) }} className="flex h-6 items-center gap-1 rounded border border-border-1 px-2 text-[11px] text-text-1 hover:border-accent">Open <ExternalLink size={10} /></button>
    }
    const checked = item.pref ? !!preferences[item.pref] : !!settings[item.server!]
    return (
      <input type="checkbox" checked={checked} aria-label={item.label} className="h-3.5 w-3.5 accent-accent"
        onChange={(event) => (item.pref ? lsp.updatePreferences({ [item.pref]: event.target.checked } as Partial<GoIDEEditorPreferences>) : void lsp.updateSettings(sessionId, { [item.server!]: event.target.checked } as Partial<GoIDELanguageServerSettings>))} />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Go Studio settings" tabIndex={-1} className="flex h-[520px] w-[720px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <Settings2 size={13} className="text-accent" />
          <h2 className="text-xs font-semibold text-text-1">Go Studio settings</h2>
          <div className="ml-4 flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded border border-border-1 bg-surface-0 px-2">
            <Search size={11} className="text-text-4" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings" aria-label="Search settings" className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-4" />
          </div>
          <button type="button" onClick={onClose} title="Close" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Settings sections" className="w-44 shrink-0 border-r border-border-1 py-2">
            {SECTIONS.map((item) => (
              <button key={item} type="button" aria-current={!needle && item === section ? 'page' : undefined} onClick={() => { setQuery(''); setSection(item) }}
                className={`block h-7 w-full px-4 text-left text-[11px] ${!needle && item === section ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:bg-surface-2 hover:text-text-1'}`}>
                {item}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-auto px-5 py-3">
            {visible.length === 0 && <p className="py-6 text-center text-[11px] text-text-4">No setting matches “{query}”.</p>}
            {visible.map((item) => (
              <div key={`${item.section}:${item.label}`} className="flex items-center gap-3 border-b border-border-1/60 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] text-text-1">{item.label}{needle && <span className="ml-1.5 text-[9.5px] text-text-4">{item.section}</span>}</div>
                  <div className="text-[10px] leading-4 text-text-4">{item.hint}</div>
                </div>
                {control(item)}
              </div>
            ))}
            {!needle && section === 'Language server' && <p className="mt-2 text-[9.5px] text-text-4">Language server settings apply to every project and restart gopls for the active one.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
