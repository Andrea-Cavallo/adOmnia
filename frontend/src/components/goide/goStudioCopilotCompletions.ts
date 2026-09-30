import { monaco } from '@/lib/monacoSetup'
import {
  didAcceptCopilotCompletion,
  didPartiallyAcceptCopilotCompletion,
  didShowCopilotCompletion,
  requestCopilotCompletion,
  type CopilotInlineItem,
} from '@/lib/copilot-api'
import { copilotCompletionsActive, useCopilotStore } from '@/stores/copilot'
import { documentForModel } from './goStudioLanguageFeatures'
import { flushGoStudioDocument } from './goStudioLspSync'

/** Attesa dopo l'ultimo tasto: abbastanza da non inseguire ogni lettera, poco da non sembrare lento. */
const TYPING_DEBOUNCE_MS = 75
const ACCEPT_COMMAND = 'goStudio.copilotAcceptCompletion'

interface CopilotInlineCompletion extends monaco.languages.InlineCompletion {
  copilotRaw: unknown
}

let registered = false

function delay(ms: number, token: monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { subscription.dispose(); resolve(!token.isCancellationRequested) }, ms)
    const subscription = token.onCancellationRequested(() => { window.clearTimeout(timer); subscription.dispose(); resolve(false) })
  })
}

function toMonaco(item: CopilotInlineItem): CopilotInlineCompletion {
  return {
    // Il server usa \\n; Monaco normalizza da sé in base all'EOL del modello.
    insertText: item.insertText,
    range: new monaco.Range(item.startLine, item.startColumn, item.endLine, item.endColumn),
    command: { id: ACCEPT_COMMAND, title: 'Accept Copilot suggestion', arguments: [item.raw] },
    copilotRaw: item.raw,
  }
}

async function provide(model: monaco.editor.ITextModel, position: monaco.Position, context: monaco.languages.InlineCompletionContext, token: monaco.CancellationToken) {
  const empty = { items: [] as CopilotInlineCompletion[] }
  if (!copilotCompletionsActive(useCopilotStore.getState())) return empty
  const document = documentForModel(model)
  if (!document || document.document.readOnly || document.document.external) return empty
  const automatic = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic
  if (automatic && !(await delay(TYPING_DEBOUNCE_MS, token))) return empty
  // Il server deve vedere il buffer esatto su cui l'utente sta scrivendo.
  const version = (await flushGoStudioDocument(document.document.id)) ?? 0
  if (token.isCancellationRequested) return empty
  const options = model.getOptions()
  const modelVersion = model.getVersionId()
  const request = requestCopilotCompletion({
    documentId: document.document.id,
    version,
    line: position.lineNumber,
    column: position.column,
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    automatic,
  })
  // Nuova digitazione = token annullato = $/cancelRequest lato server: niente ghost text obsoleto.
  const subscription = token.onCancellationRequested(() => request.cancel())
  try {
    const items = await request
    if (token.isCancellationRequested || model.getVersionId() !== modelVersion) return empty
    return { items: items.map(toMonaco), enableForwardStability: true }
  } catch {
    return empty
  } finally {
    subscription.dispose()
  }
}

/** Ghost text di GitHub Copilot per ogni linguaggio aperto in gO Studio. gopls resta il motore semantico. */
export function registerGoStudioCopilotCompletions(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(ACCEPT_COMMAND, (_accessor, raw: unknown) => { void didAcceptCopilotCompletion(raw) })
  monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
    groupId: 'github-copilot',
    provideInlineCompletions: provide,
    handleItemDidShow: (_completions, item) => { void didShowCopilotCompletion((item as CopilotInlineCompletion).copilotRaw) },
    handlePartialAccept: (_completions, item, _accepted, info) => {
      void didPartiallyAcceptCopilotCompletion((item as CopilotInlineCompletion).copilotRaw, info.acceptedLength)
    },
    disposeInlineCompletions: () => undefined,
  })
}
