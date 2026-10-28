import { monaco } from '@/lib/monacoSetup'
import { getMyBatisIndex } from '@/lib/code-studio-api'
import type { MyBatisIndex } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'
import { mybatisLinkAt, mybatisTarget, type MyBatisSide } from '@/lib/code-studio/mybatisLinks'
import { documentForModel } from './codeStudioLanguageFeatures'
import { toMonacoLocation } from './codeStudioSpring'

/** L'indice cambia solo quando cambiano i sorgenti: lo si rilegge al massimo ogni minuto. */
const INDEX_TTL_MILLIS = 60_000

let registered = false
const cache = new Map<string, { index: MyBatisIndex; at: number }>()
const pending = new Map<string, Promise<MyBatisIndex | null>>()

async function indexFor(sessionId: string): Promise<MyBatisIndex | null> {
  const cached = cache.get(sessionId)
  if (cached && Date.now() - cached.at < INDEX_TTL_MILLIS) return cached.index
  let request = pending.get(sessionId)
  if (!request) {
    request = getMyBatisIndex(sessionId)
      .then((index) => { cache.set(sessionId, { index, at: Date.now() }); return index })
      .catch(() => null)
      .finally(() => pending.delete(sessionId))
    pending.set(sessionId, request)
  }
  return request
}

function provider(side: MyBatisSide): monaco.languages.DefinitionProvider {
  return {
    async provideDefinition(model, position) {
      const document = documentForModel(model)
      if (!document) return null
      // Un'interfaccia mapper ha il metodo sulla riga; un mapper XML ha lo statement: le altre righe non costano nulla.
      const text = model.getLineContent(position.lineNumber)
      if (side === 'java' ? !/\b\w+\s*\(/.test(text) : !/<(select|insert|update|delete)\b/.test(text)) return null
      const index = await indexFor(document.document.sessionId)
      const link = index ? mybatisLinkAt(index.links ?? [], document.document.relativePath, position.lineNumber, side) : null
      const target = link ? mybatisTarget(link, side) : null
      const location = await toMonacoLocation(target, document)
      return location ? [location] : null
    },
  }
}

/** Ctrl+clic sul metodo di un mapper MyBatis porta al suo statement XML, e dall'XML al metodo. */
export function registerCodeStudioMyBatis(): void {
  if (registered) return
  registered = true
  monaco.languages.registerDefinitionProvider('java', provider('java'))
  monaco.languages.registerDefinitionProvider('xml', provider('xml'))
}
