import { parse, parseDocument, isMap, isSeq, type Node } from 'yaml'

/**
 * Parse a YAML document, tolerating the quirks found in real-world specs.
 *
 * The strict `yaml` parser rejects some constructs that are common in exported
 * OpenAPI/Swagger files — most notably plain scalars that start with a reserved
 * indicator character (e.g. `description: % of uptime`) and duplicate map keys
 * (e.g. the same `/path` declared twice, once for GET and once for POST). Those
 * throw a `YAMLParseError` even though the document is otherwise usable.
 *
 * We try the strict parser first (fast, fully validated) and, only if it fails,
 * fall back to `parseDocument` with errors downgraded. In that fallback we also
 * merge duplicate keys instead of letting the last one silently win, so a spec
 * with two `/transactions` blocks keeps both its `get` and `post` operations.
 */
export function parseYamlLenient(text: string): unknown {
  try {
    return parse(text)
  } catch (strictErr) {
    try {
      const doc = parseDocument(text, { strict: false })
      if (doc.errors.some((err) => !isRecoverableYamlError(err.code))) throw strictErr
      mergeDuplicateKeys(doc.contents)
      const js = doc.toJS()
      if (js != null) return js
    } catch {
      /* fall through to re-throw the original, clearer error */
    }
    throw strictErr
  }
}

function isRecoverableYamlError(code: string | undefined): boolean {
  return code === 'DUPLICATE_KEY' || code === 'BAD_SCALAR_START'
}

// mergeDuplicateKeys walks a parsed YAML tree and collapses pairs that share a
// key: nested maps are deep-merged (recovering split path items), scalars take
// the last value (standard last-wins). Without this, toJS() drops every dup but
// the final one.
function mergeDuplicateKeys(node: Node | null): void {
  if (isMap(node)) {
    const byKey = new Map<string, { value: unknown }>()
    const kept: typeof node.items = []
    for (const pair of node.items) {
      mergeDuplicateKeys(pair.value as Node | null)
      const k = String((pair.key as { value?: unknown })?.value ?? pair.key)
      const prev = byKey.get(k)
      if (prev && isMap(prev.value as Node) && isMap(pair.value as Node)) {
        ;(prev.value as { items: unknown[] }).items.push(...(pair.value as { items: unknown[] }).items)
        mergeDuplicateKeys(prev.value as Node)
      } else if (prev) {
        prev.value = pair.value
      } else {
        byKey.set(k, pair)
        kept.push(pair)
      }
    }
    node.items = kept
  } else if (isSeq(node)) {
    for (const item of node.items) mergeDuplicateKeys(item as Node | null)
  }
}
