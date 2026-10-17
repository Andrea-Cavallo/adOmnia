import type { BrandIconSlug } from '@/lib/brandIcons.generated'
import { GO_LANGUAGE } from './languages/go'
import { JAVA_LANGUAGE } from './languages/java'
import { WEB_LANGUAGES } from './languages/web'

/**
 * Contribuzione UI di un linguaggio dell'IDE Platform. Il backend dice quali linguaggi sono
 * registrati (`GetCapabilities().languages`); qui ognuno dichiara come appare: icona, menu e
 * linguaggi Monaco serviti dal suo language server. Aggiungere un linguaggio = una cartella in
 * `languages/<id>/` più una riga in IDE_LANGUAGES (docs/architecture/ide-multilanguage-refactor.md).
 */
export interface IdeLanguageContribution {
  /** Uguale all'ID del language adapter backend (es. "go"). */
  id: string
  name: string
  /** Icona Simple Icons (scripts/generate-brand-icons.mjs). */
  icon: BrandIconSlug
  /** ID Monaco dei file serviti dal language server: i provider LSP generici si registrano su questi. */
  editorLanguages: readonly string[]
  /** Nome del language server mostrato nella status bar (es. "gopls"). */
  languageServer?: string
  /** Menu proprio del linguaggio nella barra dei menu. */
  menu?: { id: string; label: string }
  /**
   * Funzioni tarate sul server di Go (colori semantici, inlay hints, Code Vision). Falso per i
   * linguaggi che non le hanno ancora verificate con il proprio server; default vero.
   */
  heavyFeatures?: boolean
  /**
   * Il backend gestisce il suo language server (`lsp.ServerProvider`): lo cerca, lo installa dopo
   * conferma e lo avvia all'apertura di un file. Falso per Go, che ha il proprio ciclo di vita.
   */
  providedServer?: boolean
}

/** Linguaggio registrato dal backend: basta l'identità per abilitare le contribuzioni. */
export interface IdeRegisteredLanguage {
  id: string
  name: string
}

export const IDE_LANGUAGES: readonly IdeLanguageContribution[] = [GO_LANGUAGE, ...WEB_LANGUAGES, JAVA_LANGUAGE]

/** Nome mostrato di ogni linguaggio registrato, per i riepiloghi che ricevono solo l'id dal backend. */
export const IDE_LANGUAGE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(IDE_LANGUAGES.map((language) => [language.id, language.name]))

export function ideLanguage(id: string): IdeLanguageContribution | undefined {
  return IDE_LANGUAGES.find((language) => language.id === id)
}

/** ID Monaco su cui registrare i provider LSP generici (completion, hover, semantic tokens…). */
export function languageServerEditorLanguages(): string[] {
  return IDE_LANGUAGES.flatMap((language) => language.editorLanguages)
}

/** ID Monaco su cui registrare le funzioni pesanti (colori semantici, inlay hints, Code Vision). */
export function heavyFeatureEditorLanguages(): string[] {
  return IDE_LANGUAGES.filter((language) => language.heavyFeatures !== false).flatMap((language) => language.editorLanguages)
}

/** Linguaggio dell'IDE che serve i file con questo ID Monaco (per icona, LSP, widget). */
export function ideLanguageForEditor(editorLanguage: string): IdeLanguageContribution | undefined {
  return IDE_LANGUAGES.find((language) => language.editorLanguages.includes(editorLanguage))
}

/** Il file aperto con questo ID Monaco è servito da un language server dell'IDE. */
export function isLanguageServerEditorLanguage(editorLanguage: string): boolean {
  return !!ideLanguageForEditor(editorLanguage)
}

/**
 * Disponibilità di un comando che richiede un linguaggio. `registered` undefined = capability
 * non ancora caricate: il comando resta disponibile per non lampeggiare all'avvio.
 */
export function languageRequirement(languageId: string, registered: readonly IdeRegisteredLanguage[] | undefined): true | string {
  if (!registered || registered.some((language) => language.id === languageId)) return true
  return `${ideLanguage(languageId)?.name ?? languageId} support is not available in this build`
}
