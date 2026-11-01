import TomlWorker from './tomlFormat.worker?worker'
import type { TomlFormatOptions } from './tomlFormat'

/** Release the WASM heap after each request instead of keeping another runtime alive at idle. */
export function formatTomlInWorker(source: string, options: TomlFormatOptions, signal?: AbortSignal, timeoutMs = 20000): Promise<string> {
  if (signal?.aborted) return Promise.reject(new Error('TOML formatting cancelled'))
  if (source.length > 2_000_000) return Promise.reject(new Error('TOML formatting is limited to 2,000,000 characters'))
  if (!source.trim()) return Promise.resolve(source)
  return new Promise((resolve, reject) => {
    const worker = new TomlWorker()
    const finish = (text?: string, error?: string) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate()
      if (error) reject(new Error(error)); else resolve(text ?? source)
    }
    const abort = () => finish(undefined, 'TOML formatting cancelled')
    const timer = setTimeout(() => finish(undefined, 'TOML formatting timed out; the buffer was kept unchanged'), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => finish(event.data.text, event.data.error)
    worker.onerror = () => finish(undefined, 'The TOML formatter could not start')
    worker.postMessage({ source, options })
  })
}
