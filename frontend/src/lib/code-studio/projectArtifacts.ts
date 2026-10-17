import { openGoIDEDocument, closeGoIDEDocument } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { handoffToPanel } from '@/lib/entities/dispatch'
import type { EntityRef } from '@/lib/entities/types'

export async function projectArtifactText(sessionId: string, path: string): Promise<string> {
 const open = useCodeStudioStore.getState().documents.find(item => item.document.sessionId === sessionId && item.document.relativePath === path)
 if (open) return open.buffer
 const doc = await openGoIDEDocument(sessionId, path)
 await closeGoIDEDocument(sessionId, doc.document.id).catch(() => undefined)
 return doc.content
}

export async function openProjectArtifact(ref: EntityRef, intent: 'inspect' | 'soap' | 'security' | 'xml' | 'mtls'): Promise<void> {
 if (!ref.sessionId) throw new Error('The source project is no longer open')
 const path = ref.attrs.path ?? ref.label
 if (intent === 'mtls') {
  const session = useCodeStudioStore.getState().sessions.find(item => item.id === ref.sessionId)
  if (!session) throw new Error('The source project is no longer open')
  const certificate = `${session.project.realPath.replace(/[\\/]+$/, '')}/${path}`
  handoffToPanel('settings', ref, 'mtls', { certificate })
  return
 }
 if (intent === 'inspect' && /\.(jks|p12|pfx)$/i.test(path)) {
  const { ReadProjectKeystore } = await import('../../../bindings/adomnia/goide')
  handoffToPanel('powertools', ref, 'keystore', { name: ref.label, base64: await ReadProjectKeystore(ref.sessionId, path) })
  return
 }
 const text = await projectArtifactText(ref.sessionId, path)
 const rail = intent === 'inspect' ? 'powertools' : intent === 'xml' ? 'xmltools' : 'soap'
 handoffToPanel(rail, ref, intent, { text, name: ref.label })
}
