import type { CollectionExportJob } from './collectionExport.worker'

export async function exportCollectionInBackground(job: CollectionExportJob): Promise<string> {
  if (typeof Worker === 'undefined') {
    const { createCollectionExport } = await import('./collectionExport.worker')
    return createCollectionExport(job)
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./collectionExport.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ text?: string; error?: string }>) => {
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.text ?? '')
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'Collection export failed'))
    }
    worker.postMessage(job)
  })
}
