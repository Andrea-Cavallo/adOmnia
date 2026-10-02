import { useMemo, useState } from 'react'
import { ExternalLink, Search, Settings2 } from 'lucide-react'
import { EDITOR_FONT_SIZE, useGoIDELspStore, type GoIDEEditorPreferences } from '@/stores/goideLsp'
import type { GoIDELanguageServerSettings } from '@/lib/goide-lsp-api'
import type { GoStudioCommandId } from './goStudioCommands'
import { GoStudioButton, GoStudioModal } from './GoStudioModal'

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
  { section: 'Editor', label: 'Preview tab', hint: 'A single click in Project opens a preview tab that the next click replaces.', kind: 'toggle', pref: 'previewTab' },
  { section: 'Editor', label: 'Keyboard emulation', hint: 'Vim or Emacs keys in the editor.', kind: 'select', pref: 'editorMode', options: [{ value: 'default', label: 'Default' }, { value: 'vim', label: 'Vim' }, { value: 'emacs', label: 'Emacs' }] },
  { section: 'Editor', label: 'Semantic highlighting', hint: 'Colors from gopls for parameters, variables and types.', kind: 'toggle', pref: 'semanticHighlighting' },
  { section: 'Editor', label: 'Inlay hints', hint: 'Parameter names for literals and inferred type parameters.', kind: 'toggle', pref: 'inlayHints' },
  { section: 'Editor', label: 'Type hints', hint: 'Inferred types of := and range, composite literal types, constant values.', kind: 'toggle', pref: 'typeHints' },
  { section: 'Save actions', label: 'Format on save', hint: 'gofmt (or gofumpt) through gopls.', kind: 'toggle', pref: 'formatOnSave' },
  { section: 'Save actions', label: 'Optimize imports on save', hint: 'Add missing and remove unused imports.', kind: 'toggle', pref: 'organizeImportsOnSave' },
  { section: 'Save actions', label: 'Run linter on save', hint: 'golangci-lint, staticcheck or a custom analyzer, when configured.', kind: 'toggle', pref: 'lintOnSave' },
  { section: 'Save actions', label: 'Trim trailing whitespace', hint: 'For non-Go files; Go files are already formatted.', kind: 'toggle', pref: 'trimTrailingWhitespace' },
  { section: 'Save actions', label: 'Auto save', hint: 'Save modified files when the editor loses focus.', kind: 'toggle', pref: 'autoSave' },
  { section: 'Language server', label: 'gofumpt style', hint: 'Stricter formatting rules (restarts gopls).', kind: 'toggle', server: 'gofumpt' },
  { section: 'Language server', label: 'staticcheck analyzers', hint: 'Extra analyzers inside gopls (restarts gopls).', kind: 'toggle', server: 'staticcheck' },
  { section: 'Language server', label: 'Vulnerability diagnostics', hint: 'gopls vulncheck on go.mod; needs network access to vuln.go.dev (restarts gopls).', kind: 'toggle', server: 'vulncheck' },
  { section: 'Language server', label: 'Completion placeholders', hint: 'Insert parameter placeholders when completing a call (restarts gopls).', kind: 'toggle', server: 'placeholders' },
  { section: 'Performance', label: 'Low-resource mode', hint: 'Pause semantic colors, inlay hints, sticky scroll and lint on save.', kind: 'select', pref: 'resourceMode', options: [{ value: 'normal', label: 'Off' }, { value: 'low', label: 'Always' }, { value: 'auto', label: 'Only on battery' }] },
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
          aria-label={item.label} className="gs-input w-20 text-right tabular-nums" />
      )
    }
    if (item.kind === 'select') {
      return (
        <select value={String(preferences[item.pref])} onChange={(event) => lsp.updatePreferences({ [item.pref]: event.target.value } as Partial<GoIDEEditorPreferences>)} aria-label={item.label} className="gs-input w-auto min-w-[150px]">
          {item.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )
    }
    if (item.kind === 'link') {
      return <GoStudioButton small variant="secondary" onClick={() => { onClose(); onCommand(item.command) }}>Open <ExternalLink size={12} /></GoStudioButton>
    }
    const checked = item.pref ? !!preferences[item.pref] : !!settings[item.server!]
    return (
      <input type="checkbox" role="switch" checked={checked} aria-label={item.label} className="gs-switch"
        onChange={(event) => (item.pref ? lsp.updatePreferences({ [item.pref]: event.target.checked } as Partial<GoIDEEditorPreferences>) : void lsp.updateSettings(sessionId, { [item.server!]: event.target.checked } as Partial<GoIDELanguageServerSettings>))} />
    )
  }

  return (
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="xl"
      tall
      divided
      flush
      icon={Settings2}
      title="Go Studio settings"
      subtitle="Editor, save actions, language server and tools. Changes apply right away."
    >
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border-1 bg-surface-0/40 p-3">
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings" aria-label="Search settings" className="gs-input pl-8" />
          </div>
          {SECTIONS.map((item) => {
            const active = !needle && item === section
            return (
              <button key={item} type="button" aria-current={active ? 'page' : undefined} onClick={() => { setQuery(''); setSection(item) }}
                className={`flex h-8 w-full items-center rounded-lg px-3 text-left text-[13px] transition-colors ${active ? 'bg-accent/15 font-medium text-text-1' : 'text-text-3 hover:bg-surface-2/60 hover:text-text-1'}`}>
                {item}
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto px-6 py-4">
          <h3 className="mb-2 text-[15px] font-semibold text-text-1">{needle ? `Results for “${query}”` : section}</h3>
          {visible.length === 0 && <p className="gs-list-empty">No setting matches “{query}”.</p>}
          <div className="flex flex-col">
            {visible.map((item) => (
              <div key={`${item.section}:${item.label}`} className="flex min-h-[56px] items-center gap-4 border-b border-border-1/60 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-text-1">{item.label}{needle && <span className="gs-badge ml-2 h-[18px] align-middle text-[10.5px]">{item.section}</span>}</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-text-4">{item.hint}</div>
                </div>
                {control(item)}
              </div>
            ))}
          </div>
          {!needle && section === 'Language server' && <p className="gs-hint mt-3">Language server settings apply to every project and restart gopls for the active one.</p>}
        </div>
      </div>
    </GoStudioModal>
  )
}
