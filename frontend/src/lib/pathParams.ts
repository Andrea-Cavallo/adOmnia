// REST-style path parameters: `:id` and `{id}` segments in a URL.
// Environment variables (`{{var}}`) are intentionally excluded here — they are
// resolved from the active environment, not from the path-params table.

// The `{{...}}` branch is matched first so env vars are consumed and never seen
// as `{id}` path params.
const PATH_PARAM_RE = /\{\{[^}]*\}\}|:([A-Za-z_][\w-]*)|\{([A-Za-z_][\w-]*)\}/g

function pathPortion(url: string): string {
  const withoutHash = url.split('#')[0] ?? url
  return withoutHash.split('?')[0] ?? withoutHash
}

/** Ordered, de-duplicated list of REST path-param names found in the URL path. */
export function detectPathParamKeys(url: string): string[] {
  const path = pathPortion(url)
  const seen = new Set<string>()
  const keys: string[] = []
  PATH_PARAM_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PATH_PARAM_RE.exec(path)) !== null) {
    const key = match[1] ?? match[2]
    if (key && !seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

/** Replace `:id` / `{id}` segments with provided values, leaving `{{var}}` untouched. */
export function applyPathParams(url: string, values: Record<string, string>): string {
  return url.replace(PATH_PARAM_RE, (whole, colonKey, braceKey) => {
    const key = colonKey ?? braceKey
    if (!key) return whole // matched a `{{var}}` — leave intact
    const value = values[key]
    return value != null && value !== '' ? value : whole
  })
}
