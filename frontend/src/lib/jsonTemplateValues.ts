export interface JsonEnvironmentExtraction {
  value: string
  replacement: string
}

/**
 * Prepares a selected JSON value for storage in an environment variable.
 *
 * A complete JSON string is stored without its JSON quotes, while the
 * placeholder keeps those quotes in the request body. JSON literals stay
 * untouched so numbers, booleans and null retain their types on send.
 */
export function prepareJsonEnvironmentExtraction(selection: string, reference: string): JsonEnvironmentExtraction {
  const selectedWasQuoted = selection.length >= 2
    && selection.startsWith('"')
    && selection.endsWith('"')

  if (selectedWasQuoted) {
    try {
      const parsed = JSON.parse(selection)
      if (typeof parsed === 'string') {
        return {
          value: parsed,
          replacement: `"${reference}"`,
        }
      }
    } catch {
      // Keep malformed selections intact so the editor can show its JSON error.
    }
  }

  return {
    value: selection,
    replacement: reference,
  }
}
