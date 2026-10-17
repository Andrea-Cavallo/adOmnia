import { useEffect, useId, useState } from 'react'
import { Palette } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { JSON_COLOR_KEYS, type JsonColorKey } from '@/lib/jsonColors'
import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'

const LABELS: Record<JsonColorKey, UiMessage> = {
  key: 'JSON keys', string: 'JSON strings', number: 'JSON numbers', array: 'JSON arrays []',
  object: 'JSON objects {}', bool: 'JSON booleans', null: 'JSON null',
}

/** Native popover escapes scrolling containers and provides Escape/outside dismissal. */
export function JsonColorsMenu() {
  const tr = useUiTranslation()
  const id = useId()
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const appearance = useSettingsStore(state => state.settings.appearance)
  const mode = document.documentElement.classList.contains('light') ? 'light' : 'dark'
  const palette = appearance.jsonColors?.[mode] ?? {}
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const css = getComputedStyle(document.documentElement)
      setDefaults(Object.fromEntries(JSON_COLOR_KEYS.map(key => [key, css.getPropertyValue(`--color-json-${key}`).trim()])))
    })
    return () => cancelAnimationFrame(frame)
  }, [appearance.jsonColors, mode])
  const update = (key?: JsonColorKey, value?: string) => {
    const current = useSettingsStore.getState().settings.appearance.jsonColors ?? {}
    const next = { ...current[mode] }
    if (key && value) next[key] = value
    else if (key) delete next[key]
    useSettingsStore.getState().updateAppearance({ jsonColors: { ...current, [mode]: key ? next : {} } })
  }
  return <>
    <button type="button" popoverTarget={id} aria-label={tr('JSON colors')} title={tr('JSON colors')}
      className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10.5px] font-medium text-text-2 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 430)) })
        const css = getComputedStyle(document.documentElement)
        setDefaults(Object.fromEntries(JSON_COLOR_KEYS.map(key => [key, css.getPropertyValue(`--color-json-${key}`).trim()])))
      }}><Palette size={12} />{tr('JSON colors')}</button>
    <div id={id} popover="auto" aria-label={tr('JSON colors')} style={{ ...position, margin: 0 }}
      className="fixed w-72 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-auto rounded-lg border border-border-2 bg-surface-1 p-3 text-text-1 shadow-xl">
      <p className="mb-1 text-xs font-semibold">{tr('JSON colors')}</p>
      <p className="mb-3 text-[11px] text-text-3">{tr('Saved for the current light or dark mode.')}</p>
      {JSON_COLOR_KEYS.map(key => <div key={key} className="flex items-center gap-2 py-1">
        <label className="flex flex-1 items-center justify-between gap-2 text-xs">
          {tr(LABELS[key])}
          <input type="color" aria-label={tr(LABELS[key])} value={palette[key] ?? (/^#[0-9a-f]{6}$/i.test(defaults[key] ?? '') ? defaults[key] : '#94a3b8')}
            onChange={event => update(key, event.target.value)} className="h-7 w-9 cursor-pointer rounded border border-border-2 bg-surface-2 p-0.5" />
        </label>
        <button type="button" disabled={!palette[key]} onClick={() => update(key)} title={tr('Use theme color')}
          aria-label={`${tr('Use theme color')}: ${tr(LABELS[key])}`} className="rounded px-1 text-sm text-text-3 hover:text-text-1 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-accent">↺</button>
      </div>)}
      <button type="button" onClick={() => update()} className="mt-3 w-full rounded border border-border-2 px-2 py-1.5 text-xs hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">{tr('Reset JSON colors')}</button>
    </div>
  </>
}
