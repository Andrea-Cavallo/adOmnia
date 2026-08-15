export function substVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim()
    return vars[trimmed] ?? `{{${trimmed}}}`
  })
}

/** Name of the `{{VAR}}` token sitting under `charIdx`, or null when outside one. */
export function varNameAtIndex(text: string, charIdx: number): string | null {
  const re = /\{\{([^}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (charIdx >= m.index && charIdx <= m.index + m[0].length) return m[1].trim()
  }
  return null
}
