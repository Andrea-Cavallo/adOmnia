import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Loader2, Search, X } from 'lucide-react'
import {
  BUILTIN_TEMPLATES,
  CLAUDE_TEMPLATES,
  loadCustomTemplates,
  type BuiltinTemplate,
  type ClaudeTemplate,
  type CustomTemplate,
} from '@/lib/markdownTemplates'
import { listMarkdownFiles, readMarkdownFile, selectMarkdownFolder } from '@/lib/markdown-api'
import { useSettingsStore } from '@/stores/settings'
import { cn } from '@/lib/utils'

interface TemplatePickerModalProps {
  onSelect: (content: string, filename: string) => void
  onClose: () => void
}

type AnyTemplate = (BuiltinTemplate | ClaudeTemplate | CustomTemplate) & { icon?: string }

function TemplateCard({ t, onSelect }: { t: AnyTemplate; onSelect: (content: string, filename: string) => void }) {
  const icon = t.icon ?? '📄'
  return (
    <button
      onClick={() => onSelect(t.content, t.defaultFilename)}
      className="flex items-start gap-3 p-3 bg-surface-1 border border-border-2 rounded-lg hover:border-accent hover:bg-surface-2 transition-colors text-left"
    >
      <span className="text-xl leading-none mt-0.5">{icon}</span>
      <div>
        <div className="text-[11px] font-medium text-text-1">{t.name}</div>
        <div className="text-[9px] text-text-4 mt-0.5">{t.description}</div>
      </div>
    </button>
  )
}

export function TemplatePickerModal({ onSelect, onClose }: TemplatePickerModalProps) {
  const [query, setQuery] = useState('')
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([])
  const [loadingCustom, setLoadingCustom] = useState(false)
  const templatesFolder = useSettingsStore((s) => s.settings.markdown?.templatesFolder ?? '')
  const updateMarkdown = useSettingsStore((s) => s.updateMarkdown)

  useEffect(() => {
    if (!templatesFolder) return
    setLoadingCustom(true)
    loadCustomTemplates(
      (folder) => listMarkdownFiles(folder),
      (path) => readMarkdownFile(path),
      templatesFolder,
    )
      .then(setCustomTemplates)
      .finally(() => setLoadingCustom(false))
  }, [templatesFolder])

  const handleSelectFolder = useCallback(async () => {
    const folder = await selectMarkdownFolder()
    if (folder) {
      updateMarkdown({ templatesFolder: folder })
    }
  }, [updateMarkdown])

  const q = query.toLowerCase()
  const matches = (t: { name: string; description: string }) =>
    !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)

  const builtinFiltered = BUILTIN_TEMPLATES.filter(matches)
  const claudeSystemFiltered = CLAUDE_TEMPLATES.filter((t) => t.group === 'system-prompt' && matches(t))
  const claudePatternFiltered = CLAUDE_TEMPLATES.filter((t) => t.group === 'prompt-pattern' && matches(t))
  const customFiltered = customTemplates.filter(matches)

  const hasClaudeSection = claudeSystemFiltered.length > 0 || claudePatternFiltered.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[min(96vw,720px)] h-[min(90vh,640px)] bg-surface-0 border border-border-1 rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-1 flex-shrink-0">
          <span className="text-sm font-semibold text-text-1 flex-1">New from Template</span>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border-1 flex-shrink-0">
          <div className="flex items-center gap-2 bg-surface-2 border border-border-2 rounded px-2">
            <Search size={12} className="text-text-4" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
              placeholder="Search templates…"
              className="flex-1 bg-transparent py-1.5 text-[11px] text-text-1 placeholder:text-text-4 outline-none"
            />
          </div>
        </div>

        {/* Template grid */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Built-in */}
          {builtinFiltered.length > 0 && (
            <div>
              <div className="text-[9px] text-text-4 uppercase tracking-wide mb-2">Built-in</div>
              <div className="grid grid-cols-2 gap-2">
                {builtinFiltered.map((t) => <TemplateCard key={t.id} t={t} onSelect={onSelect} />)}
              </div>
            </div>
          )}

          {/* Claude AI */}
          {hasClaudeSection && (
            <div>
              <div className="text-[9px] text-text-4 uppercase tracking-wide mb-2">Claude AI</div>

              {claudeSystemFiltered.length > 0 && (
                <>
                  <div className="text-[9px] text-text-3 font-medium mb-1.5 pl-0.5">System Prompts &amp; Personas</div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {claudeSystemFiltered.map((t) => <TemplateCard key={t.id} t={t} onSelect={onSelect} />)}
                  </div>
                </>
              )}

              {claudePatternFiltered.length > 0 && (
                <>
                  <div className="text-[9px] text-text-3 font-medium mb-1.5 pl-0.5">Prompt Engineering Patterns</div>
                  <div className="grid grid-cols-2 gap-2">
                    {claudePatternFiltered.map((t) => <TemplateCard key={t.id} t={t} onSelect={onSelect} />)}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Custom */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[9px] text-text-4 uppercase tracking-wide">Custom</div>
              <button
                onClick={() => void handleSelectFolder()}
                className="flex items-center gap-1 text-[9px] text-accent hover:underline"
              >
                <FolderOpen size={10} />
                {templatesFolder ? 'Change folder' : 'Set folder…'}
              </button>
              {loadingCustom && <Loader2 size={10} className="animate-spin text-text-4" />}
            </div>

            {customFiltered.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {customFiltered.map((t) => <TemplateCard key={t.id} t={t} onSelect={onSelect} />)}
              </div>
            ) : (
              !loadingCustom && (
                <div className={cn('text-[10px] text-text-4', templatesFolder ? '' : 'italic')}>
                  {templatesFolder
                    ? 'No .md files found in the selected folder.'
                    : 'Select a folder containing .md files to use as custom templates.'}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
