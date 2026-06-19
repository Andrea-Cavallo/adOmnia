import { parse, parseDocument } from 'yaml'

/**
 * Parse a YAML document, tolerating the quirks found in real-world specs.
 *
 * The strict `yaml` parser rejects some constructs that are common in exported
 * OpenAPI/Swagger files — most notably plain scalars that start with a reserved
 * indicator character (e.g. `description: % of uptime`). Those throw a
 * `YAMLParseError` even though the document is otherwise perfectly usable.
 *
 * We try the strict parser first (fast, fully validated) and, only if it fails,
 * fall back to `parseDocument` with errors downgraded so the resulting tree can
 * still be read. The strict error is re-thrown if even the lenient pass yields
 * nothing usable.
 */
export function parseYamlLenient(text: string): unknown {
  try {
    return parse(text)
  } catch (strictErr) {
    try {
      const doc = parseDocument(text, { strict: false })
      const js = doc.toJS()
      if (js != null) return js
    } catch {
      /* fall through to re-throw the original, clearer error */
    }
    throw strictErr
  }
}
