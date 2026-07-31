import { uid, type KVRow, type RequestItem } from '@/lib/types'
import { applyPathParams, detectPathParamKeys } from '@/lib/pathParams'
import { normalizeUrlInput } from '@/lib/urlInput'

export function queryRowsFromUrl(url: string): KVRow[] {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return []
  const hashStart = url.indexOf('#', queryStart)
  const query = url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart)
  if (!query) return []
  const rows: KVRow[] = []
  new URLSearchParams(query).forEach((value, key) => rows.push({ id: uid(), key, value, enabled: true }))
  return rows
}

export function rowsWithTrailingBlank(rows: KVRow[]): KVRow[] {
  return rows.length ? [...rows, { id: uid(), key: '', value: '', enabled: true }] : rows
}

/** Rewrites only the query string, preserving the URL path template and hash. */
export function urlWithQuery(url: string, params: KVRow[]): string {
  const hashStart = url.indexOf('#')
  const hash = hashStart === -1 ? '' : url.slice(hashStart)
  const beforeHash = hashStart === -1 ? url : url.slice(0, hashStart)
  const queryStart = beforeHash.indexOf('?')
  const base = queryStart === -1 ? beforeHash : beforeHash.slice(0, queryStart)
  const query = params
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => `${row.key}=${row.value}`)
    .join('&')
  return query ? `${base}?${query}${hash}` : `${base}${hash}`
}

export function pathParamValues(params: KVRow[] | undefined): Record<string, string> {
  return (params ?? []).reduce<Record<string, string>>((values, param) => {
    if (param.enabled && param.key.trim()) values[param.key] = param.value
    return values
  }, {})
}

/** The URL shown to the user: template path parameters are resolved live. */
export function resolvedRequestUrl(request: RequestItem): string {
  return applyPathParams(request.url, pathParamValues(request.pathParams))
}

/**
 * Updates the canonical URL template and its query/path rows together, no
 * matter whether the user edited the top request bar or the Composer URL bar.
 */
export function requestWithUrlInput(request: RequestItem, input: string): RequestItem {
  const url = normalizeUrlInput(input)
  const previousKeys = detectPathParamKeys(request.url)
  const nextKeys = detectPathParamKeys(url)
  const previousPathParams = request.pathParams ?? []
  const pathParams = nextKeys.map((key, index) => {
    const existing = previousPathParams.find((param) => param.key === key)
    if (existing) return existing
    const previousKey = previousKeys[index]
    const renamed = previousKey && !nextKeys.includes(previousKey)
      ? previousPathParams.find((param) => param.key === previousKey)
      : undefined
    return renamed ? { ...renamed, key } : { id: uid(), key, value: '', enabled: true }
  })

  return {
    ...request,
    url,
    params: rowsWithTrailingBlank(queryRowsFromUrl(url)),
    pathParams,
  }
}
