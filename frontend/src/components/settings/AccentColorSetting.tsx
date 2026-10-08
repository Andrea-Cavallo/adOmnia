import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useUiTranslation } from '@/lib/uiI18n'
import { validAccent } from '@/lib/accentPalette'

const presets = ['#7DD3FC', '#34D399', '#A78BFA', '#F472B6', '#FB923C', '#FACC15']
export function AccentColorSetting() {
  const tr = useUiTranslation()
  const selected = useSettingsStore(s => s.settings.appearance.accentColor)
  const mode = useSettingsStore(s => s.settings.appearance.theme)
  const update = useSettingsStore(s => s.updateAppearance)
  const [draft, setDraft] = useState(selected ?? '')
  const value = validAccent(selected) ? selected : mode === 'dark' ? '#FFFFFF' : '#000000'
  useEffect(() => setDraft(selected ?? ''), [selected])
  const choose = (color: string) => { setDraft(color); update({ accentColor: color }) }
  return <div className="space-y-3 border-b border-border-1 py-4">
    <div className="flex items-center justify-between gap-3"><label htmlFor="app-accent-color" className="text-xs font-medium text-text-1">{tr('Accent color')}</label><button type="button" onClick={() => { setDraft(''); update({ accentColor: undefined }) }} className="text-xs text-accent hover:underline">{tr('Use theme color')}</button></div>
    <p className="text-xs leading-relaxed text-text-3">{tr('One color across the app. Shades adapt for readable text in Dark and White.')}</p>
    <div className="flex flex-wrap items-center gap-2">
      {presets.map(color => <button key={color} type="button" aria-label={color} aria-pressed={selected?.toLowerCase() === color.toLowerCase()} onClick={() => choose(color)} style={{ backgroundColor: color }} className="h-7 w-7 rounded-full border-2 border-surface-1 outline outline-1 outline-border-2 focus-visible:ring-2 focus-visible:ring-accent aria-pressed:ring-2 aria-pressed:ring-accent" />)}
      <input id="app-accent-color" type="color" value={value} onChange={e => choose(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border-2 bg-surface-1 p-1" />
      <input aria-label={tr('Hex color')} value={draft} placeholder={value} maxLength={7} spellCheck={false} onChange={e => { setDraft(e.target.value); if (validAccent(e.target.value)) update({ accentColor: e.target.value }) }} className="h-8 w-24 rounded border border-border-2 bg-surface-1 px-2 font-mono text-xs text-text-1" />
    </div>
  </div>
}
