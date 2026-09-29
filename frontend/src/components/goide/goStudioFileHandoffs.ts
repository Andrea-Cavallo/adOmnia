import { closeGoIDEDocument, openGoIDEDocument } from '@/lib/goide-api'
import { showEntityNotice } from '@/lib/entities/notice'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useGoIDEStore } from '@/stores/goide'

const IMPORTABLE = /\.(json|ya?ml)$/i

/** File che l'import di adOmnia può riconoscere (Postman, Insomnia, Bruno JSON, OpenAPI, Swagger 2). */
export function isApiCollectionCandidate(relativePath: string): boolean {
  return IMPORTABLE.test(relativePath)
}

/** Testo del file: il buffer aperto nell'editor (anche non salvato) oppure il contenuto su disco. */
async function fileText(sessionId: string, relativePath: string): Promise<string> {
  const open = useGoIDEStore.getState().documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === relativePath)
  if (open) return open.buffer
  const document = await openGoIDEDocument(sessionId, relativePath)
  await closeGoIDEDocument(sessionId, document.document.id).catch(() => undefined)
  return document.content
}

/** Importa una collection del progetto nell'API Workspace di adOmnia e resta in Go Studio. */
export async function sendFileToApiWorkspace(sessionId: string, relativePath: string): Promise<void> {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  try {
    const { importCollectionsFromText } = await import('@/lib/collectionTransfer')
    const result = importCollectionsFromText(await fileText(sessionId, relativePath))
    if (result.collections.length === 0) throw new Error('no collection found')
    const { importCollection } = useCollectionsStore.getState()
    result.collections.forEach((collection) => importCollection(collection))
    const count = result.collections.length
    showEntityNotice(
      `${name}: ${count} ${result.format} collection${count === 1 ? '' : 's'} added to the API Workspace${result.warnings.length ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})` : ''}.`,
      { label: 'Open API Workspace', run: () => useAppStore.getState().setActiveRail('collections') },
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    showEntityNotice(`${name} is not a collection adOmnia can import (Postman, Insomnia, Bruno, OpenAPI, Swagger): ${reason}`)
  }
}

const PEM_FILE = /\.(pem|key|crt|cer)$/i

/** Chiavi e certificati PEM: si aprono nel tool PEM / JKS di Power Tools. */
export function isPemCandidate(relativePath: string): boolean {
  return PEM_FILE.test(relativePath)
}

/** Porta il PEM (anche non salvato) nel tool PEM / JKS di Power Tools: ispezione e cifratura della chiave. */
export async function openPemInPowerTools(sessionId: string, relativePath: string): Promise<void> {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  try {
    const text = await fileText(sessionId, relativePath)
    if (!text.includes('-----BEGIN ')) throw new Error('no PEM block found')
    const app = useAppStore.getState()
    app.queueFileImport({ kind: 'pem', name, text })
    app.setActiveRail('powertools')
  } catch (error) {
    showEntityNotice(`${name} cannot be opened in Power Tools: ${error instanceof Error ? error.message : String(error)}`)
  }
}
