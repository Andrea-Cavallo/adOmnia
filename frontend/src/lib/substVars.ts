export function substVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim()
    return vars[trimmed] ?? `{{${trimmed}}}`
  })
}
