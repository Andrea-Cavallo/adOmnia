import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
import type { RunTemplate } from '@/lib/code-studio/runFormTypes'
import type { BrandIconSlug } from '@/lib/brandIcons.generated'
import type { IdeFileIcon } from '@/lib/code-studio/fileIconTypes'
import { GO_LANGUAGE } from './languages/go'
import { JAVA_LANGUAGE } from './languages/java'
import { PYTHON_LANGUAGE } from './languages/python'
import { RUST_LANGUAGE } from './languages/rust'
import { WEB_LANGUAGES } from './languages/web'

/**
 * Contribuzione UI di un linguaggio dell'IDE Platform. Il backend dice quali linguaggi sono
 * registrati (`GetCapabilities().languages`); qui ognuno dichiara come appare: icona, menu e
 * linguaggi Monaco serviti dal suo language server. Aggiungere un linguaggio = una cartella in
 * `languages/<id>/` più una riga in IDE_LANGUAGES (docs/architecture/ide-package-rules.md).
 */
export interface IdeLanguageContribution {
  fileIcon?: (lowerName: string) => IdeFileIcon | undefined
  runTemplates?: readonly RunTemplate[]
  canDebugRun?: (config: GoIDERunConfiguration) => boolean
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
   * Il language server risponde a `textDocument/implementation` e i marcatori I↑/I↓ hanno senso per
   * questo linguaggio (gopls e JDT LS sì, un server senza implementazioni no).
   */
  implementationMarkers?: boolean
  /**
   * Code Vision (usi del simbolo + autore git) su questo linguaggio. Default: come `heavyFeatures`.
   * Java lo accende da solo: richiede solo document symbols e references, non gli inlay hints, che
   * restano spenti finché JDT LS non li serve davvero.
   */
  codeVision?: boolean
  /** Colori semantici (semantic tokens del language server) anche con `heavyFeatures: false`: sono generici, non tarati su gopls. */
  semanticTokens?: boolean
  /**
   * Il backend gestisce il suo language server (`lsp.ServerProvider`): lo cerca, lo installa dopo
   * conferma e lo avvia all'apertura di un file. Falso per Go, che ha il proprio ciclo di vita.
   */
  providedServer?: boolean
  /**
   * Breakpoint su eccezione del debug adapter del linguaggio: `filter` è il nome che il DAP invia
   * a `setExceptionBreakpoints` (es. debugpy: "raised", "uncaught"). Senza questa lista il
   * dialog Breakpoints non mostra la sezione (es. Delve non ha filtri del genere).
   */
  exceptionFilters?: readonly ExceptionFilterSpec[]
  /** Caratteri, oltre al punto, che aprono da soli la lista di completamento (Rust: `:` per `Vec::`). */
  completionTriggerCharacters?: readonly string[]
}

export interface ExceptionFilterSpec {
  filter: string
  label: string
  description?: string
}

/** Linguaggio registrato dal backend: basta l'identità per abilitare le contribuzioni. */
export interface IdeRegisteredLanguage {
  id: string
  name: string
}

export const IDE_LANGUAGES: readonly IdeLanguageContribution[] = [GO_LANGUAGE, ...WEB_LANGUAGES, JAVA_LANGUAGE, PYTHON_LANGUAGE, RUST_LANGUAGE]

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

/** ID Monaco su cui registrare i colori semantici: le funzioni pesanti più i linguaggi che li chiedono da soli. */
export function semanticTokenEditorLanguages(): string[] {
  return IDE_LANGUAGES.filter((language) => language.heavyFeatures !== false || language.semanticTokens).flatMap((language) => language.editorLanguages)
}

/** ID Monaco per cui ha senso calcolare i marcatori I↑/I↓ di implementazione. */
export function implementationMarkerEditorLanguages(): string[] {
  return IDE_LANGUAGES.filter((language) => language.implementationMarkers).flatMap((language) => language.editorLanguages)
}

/** ID Monaco su cui registrare Code Vision: le funzioni pesanti più i linguaggi che lo chiedono da soli. */
export function codeVisionEditorLanguages(): string[] {
  return IDE_LANGUAGES.filter((language) => language.codeVision ?? language.heavyFeatures !== false).flatMap((language) => language.editorLanguages)
}

/** Linguaggio dell'IDE che serve i file con questo ID Monaco (per icona, LSP, widget). */
export function ideLanguageForEditor(editorLanguage: string): IdeLanguageContribution | undefined {
  return IDE_LANGUAGES.find((language) => language.editorLanguages.includes(editorLanguage))
}

/** Filtri su eccezione dei linguaggi indicati, unici e in ordine: sezione Exception del dialog Breakpoints. */
export function exceptionFiltersFor(languageIDs: readonly string[]): ExceptionFilterSpec[] {
  const seen = new Set<string>()
  const filters: ExceptionFilterSpec[] = []
  for (const id of languageIDs) {
    for (const filter of ideLanguage(id)?.exceptionFilters ?? []) {
      if (seen.has(filter.filter)) continue
      seen.add(filter.filter)
      filters.push(filter)
    }
  }
  return filters
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
