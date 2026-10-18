import type { GoIDERunConfiguration } from '@/lib/code-studio-api'

export interface RunField {
  key: string; label: string; type?: string; section?: string; required?: boolean
  help?: string; default?: unknown; options?: Array<{ value: string; label: string }>
  visibleWhen?: { field: string; equals: string[] } | null
}
export interface RunTemplate {
  language: string; kind: string; label: string; group: string; target?: string
  run?: boolean
  fields?: RunField[]
}
export const field = (key: string, label: string, type = 'text', help = ''): RunField => ({ key, label, type, help, section: 'basic' })
export const templateKey = (item: Pick<RunTemplate, 'language' | 'kind'>) => `${item.language}:${item.kind}`
export const draftRecord = (draft: GoIDERunConfiguration) => draft as unknown as Record<string, unknown>
export function emptyRunConfiguration(sessionId: string): GoIDERunConfiguration {
  return { id: '', sessionId, name: 'New configuration', language: '', kind: 'command', target: '', files: [], binaryPath: '', workingDirectory: '', goArguments: [], programArguments: [], buildTags: [], goos: '', goarch: '', race: false, coverage: false, profile: '', debugFlags: [], compound: [], environment: [], docker: {}, order: 0, createdAt: '', updatedAt: '' } as GoIDERunConfiguration
}

/** Ignore empty list rows without splitting arguments that contain spaces. */
export function cleanRunConfiguration(draft: GoIDERunConfiguration): GoIDERunConfiguration {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.filter(item => typeof item !== 'string' || item.trim() !== '').map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]))
    return value
  }
  return clean(draft) as GoIDERunConfiguration
}
