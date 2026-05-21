const TIMEOUT_MS = 3000

const WORKER_CODE = `
self.onmessage = function(e) {
  try {
    const fn = new Function('ctx', '"use strict"; ' + e.data.source)
    const result = fn(e.data.ctx)
    self.postMessage({ ok: true, result })
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) })
  }
}
`

const BLOB_URL = (function () {
  const blob = new Blob([WORKER_CODE], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
})()

export function safeEval(source: string, ctx: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(BLOB_URL)

    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('Script exceeded timeout'))
    }, TIMEOUT_MS)

    worker.onmessage = (e) => {
      clearTimeout(timer)
      worker.terminate()
      if (e.data.ok) {
        resolve(e.data.result)
      } else {
        reject(new Error(e.data.error))
      }
    }

    worker.onerror = () => {
      clearTimeout(timer)
      worker.terminate()
      reject(new Error('Worker execution failed'))
    }

    worker.postMessage({ source, ctx })
  })
}
