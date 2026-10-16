import { useUiTranslation } from '@/lib/uiI18n'

export function ProjectRulesToggle({ included, onChange }: { included: boolean; onChange: (value: boolean) => void }) {
  const tr = useUiTranslation()
  return <button type="button" aria-pressed={included} onClick={() => onChange(!included)} title={tr('Include project rules (.rules, AGENTS.md, CLAUDE.md, .cursorrules)')} className="max-w-full truncate rounded border border-border-1 px-2 py-1 text-[10px] text-text-3">{included ? '✓ ' : ''}{tr('Project rules')}</button>
}
