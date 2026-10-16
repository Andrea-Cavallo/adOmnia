import { monaco } from '@/lib/monacoSetup'
import { parseProjectSettings } from '@/lib/goide/projectSettings'
import { jsonCursorContext, settingsJsonCompletions, type JsonCursorContext, type SettingsJsonSuggestion } from '@/lib/goide/settingsJsonCompletion'
import { GO_STUDIO_COMMANDS } from './goStudioCommands'

/**
 * Autocompletamento e diagnostica di `.adomnia/settings.json`. Solo per questo modello: gli
 * altri editor JSON (SpecEditor e compagnia) tengono le loro impostazioni globali, che qui non
 * si toccano.
 */

const SETTINGS_MODEL_SUFFIX = '.adomnia/settings.json'
const VALIDATION_DELAY_MS = 300

function isSettingsModel(model: monaco.editor.ITextModel): boolean {
  return model.uri.path.replace(/\\/g, '/').endsWith(SETTINGS_MODEL_SUFFIX)
}

function toCompletionItem(model: monaco.editor.ITextModel, position: monaco.Position, suggestion: SettingsJsonSuggestion, context: JsonCursorContext): monaco.languages.CompletionItem {
  const range = context.stringSpan
    ? new monaco.Range(
        model.getPositionAt(context.stringSpan.start).lineNumber,
        model.getPositionAt(context.stringSpan.start).column,
        model.getPositionAt(context.stringSpan.end).lineNumber,
        model.getPositionAt(context.stringSpan.end).column,
      )
    : new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
  return {
    label: suggestion.label,
    kind: suggestion.kind === 'key' ? monaco.languages.CompletionItemKind.Property : monaco.languages.CompletionItemKind.Value,
    detail: suggestion.detail,
    documentation: suggestion.detail ? { value: suggestion.detail } : undefined,
    insertText: suggestion.insert,
    range,
  }
}

function lineForKey(model: monaco.editor.ITextModel, message: string): number {
  if (/JSON|object/.test(message)) return 1
  const key = message.split(':')[0].split('.').pop() ?? ''
  if (!key) return 1
  const index = model.getValue().indexOf(`"${key}"`)
  return index < 0 ? 1 : model.getPositionAt(index).lineNumber
}

function validateModel(model: monaco.editor.ITextModel): void {
  const { errors } = parseProjectSettings(model.getValue())
  const markers = errors.map((message) => {
    const line = lineForKey(model, message)
    return {
      severity: monaco.MarkerSeverity.Warning,
      message,
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: model.getLineMaxColumn(line),
    }
  })
  monaco.editor.setModelMarkers(model, 'adomnia-settings', markers)
}

let registered = false

/** Registra completamento (dallo schema) e diagnostica per `.adomnia/settings.json`. */
export function registerGoStudioSettingsJson(): void {
  if (registered) return
  registered = true
  monaco.languages.registerCompletionItemProvider('json', {
    triggerCharacters: ['"', ':', ' ', '.'],
    provideCompletionItems(model, position) {
      if (!isSettingsModel(model)) return { suggestions: [] }
      const context = jsonCursorContext(model.getValue(), model.getOffsetAt(position))
      const commandLabels = Object.fromEntries(GO_STUDIO_COMMANDS.map((command) => [command.id, command.label]))
      return {
        suggestions: settingsJsonCompletions(context, GO_STUDIO_COMMANDS.map((command) => command.id), commandLabels)
          .map((suggestion) => toCompletionItem(model, position, suggestion, context)),
      }
    },
  })
  monaco.editor.onDidCreateModel((model) => {
    if (!isSettingsModel(model)) return
    let timer = 0
    model.onDidChangeContent(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => validateModel(model), VALIDATION_DELAY_MS)
    })
    validateModel(model)
  })
}
