import { javaDebugTargetOf } from '@/lib/code-studio/javaDebug'
import { javaRunTemplates } from './runTemplates'
import type { IdeLanguageContribution } from '../../languages'

/** ID del language adapter backend (`internal/languages/java`). */
export const JAVA_LANGUAGE_ID = 'java'

/**
 * Java (Maven e Gradle) con Eclipse JDT LS, installato dopo conferma nella cartella strumenti di
 * adOmnia (`lsp.ServerProvider` dell'adapter). Code Vision è accesa (usi + autore git, dagli stessi
 * document symbols e references di gopls), i marcatori I↓ contano sottotipi e override. Gli inlay
 * hints restano spenti: JDT LS 1.60 non applica la preferenza nel nostro client, quindi il toggle
 * sarebbe un pulsante che non fa nulla.
 */
export const JAVA_LANGUAGE: IdeLanguageContribution = {
  id: JAVA_LANGUAGE_ID,
  name: 'Java',
  icon: 'openjdk',
  fileIcon: name => name.endsWith('.java') ? { kind: 'java' }
    : name === 'pom.xml' ? { kind: 'brand', slug: 'apachemaven' }
    : /^(build|settings)\.gradle(\.kts)?$/.test(name) || /^gradlew(\.bat)?$/.test(name) ? { kind: 'brand', slug: 'gradle' } : undefined,
  runTemplates: javaRunTemplates,
  canDebugRun: config => javaDebugTargetOf(config) !== null,
  editorLanguages: ['java'],
  languageServer: 'Eclipse JDT LS',
  heavyFeatures: false,
  semanticTokens: true,
  codeVision: true,
  implementationMarkers: true,
  providedServer: true,
  menu: { id: 'java', label: 'Java' },
}
