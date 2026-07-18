import * as OASLintBinding from '@/wailsjs/go/main/OASLint'

export type OASLintSeverity = 'error' | 'warn' | 'info'

export interface OASLintFinding {
  ruleId: string
  severity: OASLintSeverity
  message: string
  path?: string
  method?: string
  operationId?: string
  location?: string
}

export async function lintOpenAPI(specText: string, rulesetJSON = ''): Promise<OASLintFinding[]> {
  const raw = await OASLintBinding.Lint(specText, rulesetJSON)
  const report = JSON.parse(raw) as { findings?: OASLintFinding[] }
  return report.findings ?? []
}
