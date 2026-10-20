import { loadLanguage } from '@/lib/lazyTranslations'
import { beforeAll, describe, expect, it } from 'vitest'
beforeAll(async () => { await Promise.all(['zh', 'ja', 'ru'].map(language => loadLanguage(language as 'zh' | 'ja' | 'ru'))) })
import { T, type Lang } from '@/lib/i18n'

type Tree = Record<string, unknown>

function leaves(value: Tree, prefix = ''): [string, string][] {
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return item && typeof item === 'object' ? leaves(item as Tree, path) : [[path, String(item)]]
  })
}

describe('settings localization', () => {
  it('keeps every language catalog aligned with the English source', () => {
    const reference = leaves(T.en).map(([path]) => path).sort()
    expect(reference.length).toBeGreaterThan(250)
    for (const lang of ['it', 'zh', 'ja', 'ru'] as const) {
      expect(leaves(T[lang] as Tree).map(([path]) => path).sort(), lang).toEqual(reference)
    }
  })

  it('keeps every translated settings value non-empty', () => {
    for (const lang of ['zh', 'ja', 'ru'] as const) {
      for (const [path, value] of leaves(T[lang] as Tree)) {
        expect(value.trim(), `${lang}: ${path}`).not.toBe('')
      }
    }
  })

  it('names every supported language in its native script', () => {
    for (const lang of Object.keys(T) as Lang[]) {
      expect(T[lang].settings.appearance.languageOptions).toEqual({
        en: 'English',
        it: 'Italiano',
        zh: '简体中文',
        ja: '日本語',
        ru: 'Русский',
      })
    }
  })
})
