import type { RunTemplate } from './runFormTypes'

interface ProjectContext { rootPath: string; units?: readonly { language: string; root: string }[] | null }
const normalized = (path: string) => path.replace(/\\/g, '/').replace(/(^|[^/])\/+$/, '$1')

/** Only default to a directory when the language has one unambiguous unit. */
export function templateWorkingDirectory(template: RunTemplate, project?: ProjectContext): string {
  if (!project || !template.language) return ''
  const roots = [...new Set((project.units ?? []).filter(unit => unit.language === template.language).map(unit => normalized(unit.root)))]
  if (roots.length !== 1) return ''
  const root = normalized(project.rootPath)
  if (roots[0] === root) return ''
  return roots[0].startsWith(`${root}/`) ? roots[0].slice(root.length + 1) : ''
}

/** Generic tools stay available; adapters without project units are secondary. */
export function configurationCatalog(templates: readonly RunTemplate[], project: ProjectContext | undefined, registered: readonly { id: string }[] | undefined, query: string) {
  const present = new Set(project?.units?.map(unit => unit.language) ?? [])
  const needle = query.trim().toLocaleLowerCase()
  const available = templates.filter(template => (!template.language || registered === undefined || registered.some(language => language.id === template.language))
    && `${template.group} ${template.label}`.toLocaleLowerCase().includes(needle))
  return {
    project: available.filter(template => present.has(template.language)),
    tools: available.filter(template => !template.language),
    other: available.filter(template => !!template.language && !present.has(template.language)),
  }
}
