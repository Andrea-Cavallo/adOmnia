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
