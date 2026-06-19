import type { RequestItem } from '@/lib/types'

export type RequestParamIssueKind =
  | 'query-key-whitespace'
  | 'query-value-whitespace'
  | 'path-value-whitespace'
  | 'path-placeholder-whitespace'

export interface RequestParamIssue {
  kind: RequestParamIssueKind
  field: string
  message: string
}

const MALFORMED_BRACE_PATH_PARAM_RE = /\{([^{}]*\s+[^{}]*)\}/g

/** Validate parameter mistakes that would otherwise be silently URL-encoded. */
export function validateRequestParams(request: RequestItem): RequestParamIssue[] {
  const issues: RequestParamIssue[] = []

  for (const [index, param] of (request.params ?? []).entries()) {
    if (!param.enabled) continue
    const key = param.key ?? ''
    const value = param.value ?? ''

    // A completely empty row is the editor's trailing input row.
    if (key === '' && value === '') continue

    if (key.trim() === '' || /\s/.test(key)) {
      issues.push({
        kind: 'query-key-whitespace',
        field: `Query param ${index + 1}`,
        message: 'The parameter name cannot be empty or contain spaces.',
      })
    }
    if (value !== '' && value.trim() === '') {
      issues.push({
        kind: 'query-value-whitespace',
        field: key.trim() ? `Query param "${key.trim()}"` : `Query param ${index + 1}`,
        message: 'The value contains only spaces. Enter a value or leave it empty.',
      })
    }
  }

  for (const param of request.pathParams ?? []) {
    if (!param.enabled) continue
    const value = param.value ?? ''
    if (value !== '' && value.trim() === '') {
      issues.push({
        kind: 'path-value-whitespace',
        field: `Path param "${param.key}"`,
        message: 'The value contains only spaces. Enter a valid path value.',
      })
    }
  }

  const pathOnly = (request.url.split('#')[0] ?? request.url).split('?')[0] ?? request.url
  MALFORMED_BRACE_PATH_PARAM_RE.lastIndex = 0
  let malformed: RegExpExecArray | null
  while ((malformed = MALFORMED_BRACE_PATH_PARAM_RE.exec(pathOnly)) !== null) {
    issues.push({
      kind: 'path-placeholder-whitespace',
      field: `Path placeholder "{${malformed[1]}}"`,
      message: 'Path parameter names cannot contain spaces.',
    })
  }

  return issues
}
