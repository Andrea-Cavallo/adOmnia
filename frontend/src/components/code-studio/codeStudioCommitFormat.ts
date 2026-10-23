import { safeSetItem } from '@/lib/safeLocalStorage'

/**
 * Formato del messaggio di commit proposto dall'AI. La preferenza è locale e additiva: chi non
 * l'ha mai impostata usa Conventional Commits, come prima (10.8). Il messaggio resta sempre una
 * bozza modificabile: l'AI non committa nulla.
 */
export type CommitFormat = 'conventional' | 'free' | 'template'

export interface CommitFormatPreference {
  format: CommitFormat
  /** Template personalizzato, usato solo con format === 'template'. */
  template: string
}

export const COMMIT_FORMAT_KEY = 'adomnia.codeStudio.commitFormat'

/** Un template ragionevole: riassunto, riga vuota, corpo. Senza placeholder non è un template. */
export const DEFAULT_COMMIT_TEMPLATE = '{{summary}}\n\n{{body}}'

export const DEFAULT_COMMIT_FORMAT: CommitFormatPreference = { format: 'conventional', template: DEFAULT_COMMIT_TEMPLATE }

/** Placeholder riconosciuti nel template; tutto il resto è testo letterale. */
export const COMMIT_TEMPLATE_PLACEHOLDERS = ['{{summary}}', '{{body}}'] as const

const FORMATS: readonly CommitFormat[] = ['conventional', 'free', 'template']

/**
 * Normalizza il template: righe vuote ai bordi tolte. Un template vuoto non è valido e torna a
 * quello predefinito; se manca `{{summary}}` viene anteposto, così il soggetto esiste sempre.
 */
export function normalizeCommitTemplate(template: string): string {
  const trimmed = template.replace(/\r\n/g, '\n').replace(/^\n+/, '').trimEnd()
  if (!trimmed) return DEFAULT_COMMIT_TEMPLATE
  if (trimmed.includes('{{summary}}')) return trimmed
  return `{{summary}}\n\n${trimmed}`
}

/** Legge la preferenza salvata; valori ignoti o corrotti tornano al default, senza migrazioni. */
export function loadCommitFormat(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): CommitFormatPreference {
  try {
    const raw = storage?.getItem(COMMIT_FORMAT_KEY)
    if (!raw) return DEFAULT_COMMIT_FORMAT
    const parsed = JSON.parse(raw) as Partial<CommitFormatPreference>
    const format = FORMATS.includes(parsed.format as CommitFormat) ? parsed.format as CommitFormat : 'conventional'
    return { format, template: normalizeCommitTemplate(typeof parsed.template === 'string' ? parsed.template : '') }
  } catch {
    return DEFAULT_COMMIT_FORMAT
  }
}

export function saveCommitFormat(preference: CommitFormatPreference, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  const value = JSON.stringify({ format: preference.format, template: normalizeCommitTemplate(preference.template) })
  if (!storage) return
  try {
    storage.setItem(COMMIT_FORMAT_KEY, value)
  } catch {
    // Quota o storage bloccato: il wrapper condiviso segnala l'errore all'utente.
    safeSetItem(COMMIT_FORMAT_KEY, value)
  }
}

/**
 * Istruzioni per il modello secondo il formato scelto. Neutrali rispetto al linguaggio: lo stesso
 * prompt vale per Go, Java, Python e per un diff misto.
 */
export function commitFormatInstructions(preference: CommitFormatPreference): string {
  if (preference.format === 'template') {
    const template = normalizeCommitTemplate(preference.template)
    return [
      'Follow this exact commit message template, replacing the placeholders with the real content:',
      '{{summary}} is a concise subject line under 72 characters; {{body}} explains why or what it affects, and may be empty.',
      'Keep the literal text of the template (prefixes, separators, sections). Do not add anything outside the template.',
      'Template:',
      '<<<',
      template,
      '>>>',
    ].join('\n')
  }
  if (preference.format === 'free') {
    return [
      'Write a clear commit message in plain prose: one concise subject line under 72 characters, then an optional short body.',
      'Do not force a Conventional Commits prefix and do not add a type or scope the change does not have.',
    ].join('\n')
  }
  return [
    'Use Conventional Commits: a type (feat, fix, refactor, test, docs, chore, perf, ci, build) with an optional scope, then a concise imperative subject under 72 characters.',
    'Add a short body only when it explains why the change was needed or what it affects.',
  ].join('\n')
}
