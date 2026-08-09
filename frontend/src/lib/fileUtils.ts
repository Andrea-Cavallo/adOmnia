import * as AppBindings from '../../bindings/adomnia/app'
export function safeSelectFolder(title: string): Promise<string> {
  // Wails 3 has no `window.go` global; the binding is imported directly.
  const fn = AppBindings.SelectFolder
  if (!fn) return Promise.reject(new Error('Wails bridge not available — run inside the desktop app'))
  return fn(title)
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function readFileSmart(file: File): Promise<{ text: string; bytes: Uint8Array }> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let text = ''
    try {
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } catch {
      text = ''
    }
    return { text, bytes }
  })
}
