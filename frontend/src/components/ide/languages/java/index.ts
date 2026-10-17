import type { IdeLanguageContribution } from '../../languages'

/** ID del language adapter backend (`internal/languages/java`). */
export const JAVA_LANGUAGE_ID = 'java'

/**
 * Java (Maven e Gradle). `editorLanguages` resta vuoto finché il suo language server (Eclipse JDT LS)
 * non c'è: quella lista dice a quali file registrare i provider LSP generici, e senza server
 * non devono rispondere. Si riempie con il passo del server (docs/architecture, Fase 9.4).
 */
export const JAVA_LANGUAGE: IdeLanguageContribution = {
  id: JAVA_LANGUAGE_ID,
  name: 'Java',
  icon: 'openjdk',
  editorLanguages: [],
  heavyFeatures: false,
}
