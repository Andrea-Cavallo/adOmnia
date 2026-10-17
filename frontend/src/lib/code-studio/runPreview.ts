import type { LivePreviewReport, LivePreviewRequest } from '../livepreview-api'

interface ConfigLike { kind?: string; language?: string; workingDirectory?: string; programArguments?: ReadonlyArray<string> | null }

const slash = (path: string) => path.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/+$/, '') || '.'

/**
 * Se la configurazione lancia lo script dev di un'app Node (`<pm> run dev`), Run deve aprire la Live Preview:
 * è la preview a possedere il dev server (URL, prontezza, proxy), non un secondo processo in console.
 */
export function devServerPreviewRequest(config: ConfigLike | null | undefined, report: LivePreviewReport | null): LivePreviewRequest | null {
  if (!config || config.kind !== 'command' || !report) return null
  const [verb, script] = config.programArguments ?? []
  if (verb !== 'run' || !script) return null
  const directory = slash(config.workingDirectory ?? '')
  const target = report.targets.find((item) => item.kind === 'node' && item.devScript === script && slash(item.relative) === directory)
  return target ? { mode: 'devserver', dir: target.relative, script } : null
}

/**
 * ▶ senza configurazione apre la Live Preview solo se il progetto ha qualcosa da mostrare: un sito statico o
 * un'app Node con un dev tool o un framework UI riconosciuto. Uno script Node semplice (`node index.js`) non è
 * un'app web: la preview fallirebbe con "exited before it was ready", meglio proporre le configurazioni.
 */
export function hasWebAppToPreview(report: LivePreviewReport | null): boolean {
  return !!report?.targets.some((target) => !!target.entryHtml || (target.kind === 'node' && (!!target.tool || !!target.framework)))
}
