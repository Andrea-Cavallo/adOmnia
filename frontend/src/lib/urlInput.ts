export function normalizeUrlInput(value: string): string {
  return value.replace(/[\t\r\n]+/g, '').trim()
}
