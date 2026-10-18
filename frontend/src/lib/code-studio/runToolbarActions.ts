import { templateFor } from './runFormSchema'
import type { GoIDERunConfiguration, GoIDESession } from '@/lib/code-studio-api'
import { testTargets } from './testTargets'
import { unitOfConfiguration } from './runUnits'
export function configurationTestTarget(project: GoIDESession['project'], config: GoIDERunConfiguration | null) {
  const targets = testTargets(project)
  if (!config) return targets[0] ?? null
  if (!config.language && templateFor(config).group === 'Generic') return null
  const unit = unitOfConfiguration(config, project)
  const root = project.rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  const directory = unit?.root.replace(/\\/g, '/').replace(/\/$/, '')
  const relative = directory === root ? '' : directory?.startsWith(root + '/') ? directory.slice(root.length + 1) : directory
  return targets.find(target => target.workingDirectory === relative && (!config.language || target.language === config.language)) ?? null
}
