import { useEffect } from 'react'
import { monaco } from '@/lib/monacoSetup'
import { registerEmmet } from './emmet'
import { useIdeLanguageServersStore, serverLanguageForEditor, serverEntry } from '@/stores/ideLanguageServers'

/**
 * Monaco porta con sé i servizi di JS/TS, HTML, CSS e JSON: senza language server sono l'unico
 * aiuto (e restano). Quando il language server standard è pronto lo sostituisce, e i servizi di
 * Monaco si spengono per quel linguaggio, così completamenti, hover e diagnostica non compaiono due volte.
 *
 * Le impostazioni di Monaco sono globali, e altre parti di adOmnia usano lo stesso Monaco (l'editor
 * degli script API): per questo si spengono solo finché c'è un editor di Code Studio con un file di
 * quel linguaggio e il suo server pronto, e si riaccendono quando l'ultimo si chiude.
 */

type Group = 'typescript' | 'html' | 'css' | 'json'

const GROUP_OF: Record<string, Group> = { typescript: 'typescript', html: 'html', css: 'css', json: 'json' }
const holders: Record<Group, number> = { typescript: 0, html: 0, css: 0, json: 0 }

/** Codici TS di "non trovo il modulo/tipo": senza il progetto davanti, Monaco li sbaglierebbe tutti. */
const UNRESOLVED_CODES = [2307, 2792, 2688, 7016, 7026, 2503, 2580, 2584, 2339, 2304]

let compilerConfigured = false

function configureCompiler(): void {
  if (compilerConfigured) return
  compilerConfigured = true
  const { typescript } = monaco
  for (const defaults of [typescript.typescriptDefaults, typescript.javascriptDefaults]) {
    defaults.setCompilerOptions({
      ...defaults.getCompilerOptions(),
      target: typescript.ScriptTarget.ESNext,
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.NodeJs,
      jsx: typescript.JsxEmit.ReactJSX,
      allowJs: true,
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
    })
  }
}

/** Servizi di Monaco di un gruppo: tutti accesi, oppure solo quelli che il language server non copre. */
function setBuiltinServices(group: Group, enabled: boolean): void {
  switch (group) {
    case 'typescript':
      for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
        defaults.setModeConfiguration({ ...defaults.modeConfiguration, completionItems: enabled, hovers: enabled, documentSymbols: enabled, definitions: enabled, references: enabled, rename: enabled, diagnostics: enabled, signatureHelp: enabled, codeActions: enabled, documentRangeFormattingEdits: enabled, onTypeFormattingEdits: enabled })
      }
      break
    case 'html':
      monaco.html.htmlDefaults.setModeConfiguration({ ...monaco.html.htmlDefaults.modeConfiguration, completionItems: enabled, hovers: enabled, documentSymbols: enabled, rename: enabled, diagnostics: enabled, documentFormattingEdits: enabled, documentRangeFormattingEdits: enabled })
      break
    case 'css':
      for (const defaults of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
        defaults.setModeConfiguration({ ...defaults.modeConfiguration, completionItems: enabled, hovers: enabled, definitions: enabled, references: enabled, documentSymbols: enabled, rename: enabled, diagnostics: enabled, documentFormattingEdits: enabled, documentRangeFormattingEdits: enabled })
      }
      break
    case 'json':
      monaco.json.jsonDefaults.setModeConfiguration({ ...monaco.json.jsonDefaults.modeConfiguration, completionItems: enabled, hovers: enabled, documentSymbols: enabled, diagnostics: enabled, documentFormattingEdits: enabled, documentRangeFormattingEdits: enabled })
      break
  }
}

/** Fino al rilascio, il language server del gruppo sostituisce i servizi di Monaco. */
function holdServerInsteadOfBuiltins(group: Group): () => void {
  holders[group] += 1
  if (holders[group] === 1) setBuiltinServices(group, false)
  return () => {
    holders[group] = Math.max(0, holders[group] - 1)
    if (holders[group] === 0) setBuiltinServices(group, true)
  }
}

/** Senza il progetto davanti Monaco non risolve gli import: non li segnala come errori. */
function ignoreUnresolvedImports(): void {
  for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
    const current = defaults.getDiagnosticsOptions()
    const ignored = new Set([...(current.diagnosticCodesToIgnore ?? []), ...UNRESOLVED_CODES])
    defaults.setDiagnosticsOptions({ ...current, diagnosticCodesToIgnore: [...ignored] })
  }
}

/**
 * Da chiamare dall'editor di un file: configura il fallback di Monaco per i linguaggi web e, se il
 * language server del file è pronto, lo sostituisce ai servizi di Monaco per la vita dell'editor.
 */
export function useWebMonaco(sessionId: string, editorLanguage: string): void {
  const languageId = serverLanguageForEditor(editorLanguage)
  const group = languageId ? GROUP_OF[languageId] : undefined
  const ready = useIdeLanguageServersStore((state) => (languageId ? serverEntry(state, sessionId, languageId).state === 'ready' : false))

  useEffect(() => {
    if (!group) return
    configureCompiler()
    registerEmmet()
    if (group === 'typescript' && !ready) ignoreUnresolvedImports()
  }, [group, ready])

  useEffect(() => {
    if (!group || !ready) return
    return holdServerInsteadOfBuiltins(group)
  }, [group, ready])
}
