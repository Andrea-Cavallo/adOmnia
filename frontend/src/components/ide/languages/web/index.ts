import { webRunTemplates } from './runTemplates'
import type { IdeLanguageContribution } from '../../languages'

/** ID dei language adapter web (`internal/languages/web`). */
export const WEB_SCRIPT_ID = 'typescript'
export const WEB_HTML_ID = 'html'
export const WEB_CSS_ID = 'css'
export const WEB_JSON_ID = 'json'

/**
 * Linguaggi del web frontend: ognuno ha il suo language server standard, avviato solo se esiste e
 * solo quando si apre un file del linguaggio. Senza server restano le funzioni di Monaco.
 * `heavyFeatures: false` lascia fuori le funzioni tarate su gopls (colori semantici, inlay hints,
 * Code Vision): quelle dei server web si abilitano caso per caso, non per default.
 */
export const WEB_LANGUAGES: readonly IdeLanguageContribution[] = [
  { id: WEB_SCRIPT_ID, runTemplates: webRunTemplates, name: 'TypeScript / JavaScript', icon: 'typescript', editorLanguages: ['typescript', 'javascript'], languageServer: 'typescript-language-server', heavyFeatures: false, providedServer: true },
  { id: WEB_HTML_ID, name: 'HTML', icon: 'html5', editorLanguages: ['html'], languageServer: 'vscode-html-language-server', heavyFeatures: false, providedServer: true },
  { id: WEB_CSS_ID, name: 'CSS', icon: 'css', editorLanguages: ['css', 'scss', 'less'], languageServer: 'vscode-css-language-server', heavyFeatures: false, providedServer: true },
  { id: WEB_JSON_ID, name: 'JSON', icon: 'json', editorLanguages: ['json'], languageServer: 'vscode-json-language-server', heavyFeatures: false, providedServer: true },
]

export const WEB_LANGUAGE_IDS: readonly string[] = WEB_LANGUAGES.map((language) => language.id)
