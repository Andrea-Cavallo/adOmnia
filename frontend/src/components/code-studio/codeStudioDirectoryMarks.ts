export type CodeStudioDirectoryMark = 'sources' | 'tests' | 'resources' | 'excluded'

const PREFIX = 'adomnia.goide.directory-marks.v1.'

function key(rootPath: string): string {
  return `${PREFIX}${rootPath.replace(/\\/g, '/').toLowerCase()}`
}

export function loadDirectoryMarks(rootPath: string): Record<string, CodeStudioDirectoryMark> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(rootPath)) ?? '{}') as Record<string, string>
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => ['sources', 'tests', 'resources', 'excluded'].includes(value))) as Record<string, CodeStudioDirectoryMark>
  } catch {
    return {}
  }
}

export function saveDirectoryMark(rootPath: string, relativePath: string, mark: CodeStudioDirectoryMark | null): Record<string, CodeStudioDirectoryMark> {
  const marks = loadDirectoryMarks(rootPath)
  if (mark) marks[relativePath] = mark
  else delete marks[relativePath]
  localStorage.setItem(key(rootPath), JSON.stringify(marks))
  return marks
}

export function directoryMarkLabel(mark: CodeStudioDirectoryMark): string {
  return ({ sources: 'Sources', tests: 'Tests', resources: 'Resources', excluded: 'Excluded' })[mark]
}
