import type { IdeLanguageContribution } from '../../languages'

/** ID del language adapter backend (`internal/languages/java`). */
export const JAVA_LANGUAGE_ID = 'java'

/**
 * Java (Maven e Gradle) con Eclipse JDT LS, installato dopo conferma nella cartella strumenti di
 * adOmnia (`lsp.ServerProvider` dell'adapter). `heavyFeatures` resta spento (inlay hints e Code Vision non
 * sono verificati con JDT LS); i colori semantici sono accesi: JDT LS li serve come gopls.
 */
export const JAVA_LANGUAGE: IdeLanguageContribution = {
  id: JAVA_LANGUAGE_ID,
  name: 'Java',
  icon: 'openjdk',
  editorLanguages: ['java'],
  languageServer: 'Eclipse JDT LS',
  heavyFeatures: false,
  semanticTokens: true,
  providedServer: true,
}
