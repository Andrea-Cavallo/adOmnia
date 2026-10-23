export interface AgentAttachment {
  name: string
  mimeType: string
  kind: 'text' | 'image'
  text?: string
  data?: string
}

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Explicit user-selected files only. Bytes remain in the composer until Send. */
export async function readAgentAttachments(files: File[], imageSupported: boolean): Promise<AgentAttachment[]> {
  if (files.length > 6) throw new Error('Attach at most six files.')
  let bytes = 0
  return Promise.all(files.map(async file => {
    bytes += file.size
    if (bytes > 8 * 1024 * 1024) throw new Error('Attachments exceed 8 MiB in total.')
    if (imageTypes.has(file.type)) {
      if (!imageSupported) throw new Error('This agent does not accept images through ACP. Choose an image-capable agent such as Claude Code; text files are supported.')
      if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name}: image exceeds 4 MiB.`)
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error(`Cannot read ${file.name}`))
        reader.readAsDataURL(file)
      })
      return { name: file.name, mimeType: file.type, kind: 'image' as const, data }
    }
    if (file.size > 48 * 1024) throw new Error(`${file.name}: text attachments are limited to 48 KiB. Attach an excerpt.`)
    const buffer = await file.arrayBuffer()
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { throw new Error(`${file.name}: attach UTF-8 text, source files, or a supported image.`) }
    if (text.includes('\0') || file.type === 'application/pdf' || text.startsWith('PK\x03\x04') || text.startsWith('%PDF-')) throw new Error(`${file.name}: this binary format cannot be attached as text.`)
    return { name: file.name, mimeType: 'text/plain', kind: 'text' as const, text }
  }))
}
