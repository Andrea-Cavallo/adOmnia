import { useEffect, useSyncExternalStore } from 'react'
import { useSettingsStore } from '@/stores/settings'
import type { Lang } from './i18n'

interface Catalog { settings: unknown; ui: Record<string, string>; navigation: Record<string, string>; personal: Record<string, string> }
const catalogs: Partial<Record<Lang, Catalog>> = {}
const pending = new Map<Lang, Promise<void>>()
const listeners = new Set<() => void>()
let revision = 0
export const languageCatalog = (language: Lang) => catalogs[language]
export function loadLanguage(language: Lang): Promise<void> {
 if (language === 'en' || language === 'it' || catalogs[language]) return Promise.resolve()
 const existing = pending.get(language); if (existing) return existing
 const loading = (async () => {
  let catalog: Catalog
  switch (language) {
   case 'zh': { const [s,a,b] = await Promise.all([import('./translations/settings.zh'),import('./translations/ui.zh.a'),import('./translations/ui.zh.b')]); catalog = { settings:s.ZH_TRANSLATIONS, ui:{...a.ZH_UI_MESSAGES_A,...b.ZH_UI_MESSAGES_B}, navigation:b.ZH_NAVIGATION_MESSAGES, personal:s.ZH_PERSONAL_APPEARANCE_MESSAGES }; break }
   case 'ja': { const [s,a,b] = await Promise.all([import('./translations/settings.ja'),import('./translations/ui.ja.a'),import('./translations/ui.ja.b')]); catalog = { settings:s.JA_TRANSLATIONS, ui:{...a.JA_UI_MESSAGES_A,...b.JA_UI_MESSAGES_B}, navigation:b.JA_NAVIGATION_MESSAGES, personal:s.JA_PERSONAL_APPEARANCE_MESSAGES }; break }
   case 'ru': { const [s,a,b] = await Promise.all([import('./translations/settings.ru'),import('./translations/ui.ru.a'),import('./translations/ui.ru.b')]); catalog = { settings:s.RU_TRANSLATIONS, ui:{...a.RU_UI_MESSAGES_A,...b.RU_UI_MESSAGES_B}, navigation:b.RU_NAVIGATION_MESSAGES, personal:s.RU_PERSONAL_APPEARANCE_MESSAGES }; break }
   default: return
  }
  catalogs[language] = catalog; revision++; listeners.forEach((listener) => listener())
 })().finally(() => pending.delete(language))
 pending.set(language, loading); return loading
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useTranslationLanguage(): Lang {
 const language = useSettingsStore(state => state.settings.appearance.language ?? 'en')
 useSyncExternalStore(subscribe, () => revision, () => revision)
 useEffect(() => { void loadLanguage(language).catch((error) => console.error('Language catalog could not be loaded', error)) }, [language])
 return language
}
