import { monaco, type Monaco } from '@/lib/monacoRef'
import { IDE_LANGUAGES } from '@/components/ide/languages'
import { templateSnippet, templatesFor, type LiveTemplate } from '@/lib/code-studio/liveTemplates'
import { pickGoIDEFile } from '@/lib/codeStudioFilePicker'
import { saveTextFile } from '@/lib/fileUtils'
import { useLiveTemplates } from '@/stores/codeStudioLiveTemplates'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { documentForModel } from './codeStudioLanguageFeatures'

export function liveTemplateCatalog(): LiveTemplate[] {
  const catalog = new Map(IDE_LANGUAGES.flatMap(language => language.liveTemplates ?? []).map(template => [template.id, template]))
  for (const template of useLiveTemplates.getState().templates) catalog.set(template.id, template)
  return [...catalog.values()]
}

/** Monaco token types prevent normal completion from proposing code inside comments or strings. */
export function isTemplateCodePosition(model: Monaco.editor.ITextModel, position: Monaco.Position): boolean {
  // Explicit insertion remains available in large files; automatic completion has a bounded parse budget.
  if (model.getOffsetAt(position) > 128 * 1024 || model.getLineMaxColumn(position.lineNumber) > 128 * 1024) return false
  const line = model.getLineContent(position.lineNumber)
  const offset = Math.max(0, position.column - 2)
  const lines = monaco.editor.tokenize(model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: line.length + 1 }), model.getLanguageId())
  const tokens = lines[lines.length - 1] ?? []
  const token = [...tokens].reverse().find(item => item.offset <= offset)
  return !token || !/(comment|string|regexp)/i.test(token.type)
}

let registered = false
export function registerLiveTemplateCompletions(): void {
  if (registered) return
  registered = true
  for (const language of new Set(IDE_LANGUAGES.flatMap(item => item.editorLanguages))) {
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model, position) {
        const document = documentForModel(model)
        if (!document || document.document.readOnly || !isTemplateCodePosition(model, position)) return { suggestions: [] }
        const word = model.getWordUntilPosition(position)
        if (!word.word) return { suggestions: [] }
        return { suggestions: templatesFor(liveTemplateCatalog(), language, false)
          .filter(template => template.abbreviation.toLowerCase().startsWith(word.word.toLowerCase()))
          .map(template => ({
            label: template.abbreviation, detail: `Live template · ${template.description}`,
            documentation: { value: '```\n' + template.body + '\n```' },
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            insertText: templateSnippet(template.body),
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          })) }
      },
    })
  }
}

export async function insertLiveTemplate(editor: Monaco.editor.ICodeEditor, surround: boolean): Promise<void> {
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (!model || !selection || editor.getOption(monaco.editor.EditorOption.readOnly)) return
  const document = documentForModel(model)
  if (!document || document.document.readOnly || document.document.external) return
  const sessionId = document.document.sessionId
  if (surround && selection.isEmpty()) {
    useCodeStudioLspStore.setState({ message: 'Select code to surround with a template.' })
    return
  }
  const templates = templatesFor(liveTemplateCatalog(), model.getLanguageId(), surround)
  if (!templates.length) {
    useCodeStudioLspStore.setState({ message: 'No templates for this editor language. Import templates from the Code menu.' })
    return
  }
  const version = model.getVersionId()
  const id = await pickGoIDEFile({ title: surround ? 'Surround With' : 'Insert Live Template', kind: 'template', items: templates.map(template => ({ id: template.id, name: template.abbreviation, detail: template.description })) })
  // Let the palette's focus trap unmount before returning focus to the editor's snippet field.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  if (!id) {
    if (!model.isDisposed() && editor.getModel() === model && useCodeStudioStore.getState().activeSessionId === sessionId) editor.focus()
    return
  }
  if (model.isDisposed() || editor.getModel() !== model || model.getVersionId() !== version || useCodeStudioStore.getState().activeSessionId !== sessionId || editor.getOption(monaco.editor.EditorOption.readOnly)) {
    useCodeStudioLspStore.setState({ message: 'Template not inserted: the document changed while choosing.' })
    return
  }
  const template = templates.find(item => item.id === id)
  if (!template) return
  // Monaco exposes snippet insertion through this contribution, not VS Code's insertSnippet command.
  const controller = editor.getContribution<Monaco.editor.IEditorContribution & { insert: (snippet: string) => void }>('snippetController2')
  if (!controller) {
    useCodeStudioLspStore.setState({ message: 'The editor snippet controller is not available.' })
    return
  }
  const indent = model.getLineContent(selection.startLineNumber).match(/^\s*/)?.[0] ?? ''
  const selected = model.getValueInRange(selection).split(/\r?\n/).map((line, index) => (index > 0 || selection.startColumn === 1) && line.startsWith(indent) ? line.slice(indent.length) : line).join('\n')
  editor.setSelection(selection)
  editor.focus()
  controller.insert(templateSnippet(template.body, selected))
}

export async function exportLiveTemplates(): Promise<void> {
  try { await saveTextFile('adomnia-live-templates.json', JSON.stringify(liveTemplateCatalog(), null, 2), 'application/json') }
  catch (error) { useCodeStudioStore.setState({ error: String(error) }) }
}

export function importLiveTemplates(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 1024 * 1024) { useCodeStudioStore.setState({ error: 'Template import exceeds 1 MiB.' }); return }
    void file.text().then(raw => {
      useLiveTemplates.getState().replace(raw)
      useCodeStudioLspStore.setState({ message: 'Live templates imported. Matching ids update existing templates; other custom templates were kept.' })
    }).catch(error => useCodeStudioStore.setState({ error: `Templates not imported: ${String(error)}` }))
  }
  input.click()
}
