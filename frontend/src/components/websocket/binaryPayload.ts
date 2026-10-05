const PREVIEW_BYTES = 4096

export function binaryPayloadPreview(content: string): { size: number; rows: string[]; truncated: boolean } | null {
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) return null
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0
  const size = content.length / 4 * 3 - padding
  if (size < 0) return null

  try {
    const encodedPreview = content.slice(0, Math.ceil(Math.min(size, PREVIEW_BYTES) / 3) * 4)
    const decoded = atob(encodedPreview).slice(0, PREVIEW_BYTES)
    const rows: string[] = []
    for (let offset = 0; offset < decoded.length; offset += 16) {
      const chunk = decoded.slice(offset, offset + 16)
      const hex = Array.from(chunk, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join(' ')
      const ascii = Array.from(chunk, (char) => {
        const code = char.charCodeAt(0)
        return code >= 32 && code <= 126 ? char : '.'
      }).join('')
      rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`)
    }
    return { size, rows, truncated: size > PREVIEW_BYTES }
  } catch {
    return null
  }
}
