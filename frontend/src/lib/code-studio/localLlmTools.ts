import { closeGoIDEDocument, createGoIDEFiles, getGoIDEAIPolicy, listGoIDEAIExcludedPaths, openGoIDEDocument, quickOpenGoIDEFiles, type GoIDESession } from '@/lib/code-studio-api'
import { requestWorkspaceSymbols } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { createAIRedactor } from '@/lib/aiRedaction'
import type { LocalToolCall } from '@/lib/localLlm'

/** `create` marks a new file: `original` is empty and applying writes it to disk instead of an editor buffer. */
export interface LocalEditProposal { path: string; original: string; updated: string; applied?: boolean; create?: boolean }
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } })
const string = { type: 'string' }
export const LOCAL_PROJECT_TOOLS = [
  tool('list_project_files', 'Find project files by name. Returns paths, not contents.', { query: string }, ['query']),
  tool('read_project_file', 'Read a project-relative file, including its unsaved editor buffer. AI exclusions apply.', { path: string }, ['path']),
  tool('search_project_symbols', 'Find functions, classes and symbols using the project language servers.', { query: string }, ['query']),
  tool('propose_edit', 'Propose one exact text replacement in an existing project file. The user must preview and apply it. It does not write files.', { path: string, before: string, after: string }, ['path', 'before', 'after']),
  tool('propose_create_file', 'Propose a new project file with its full content. The user must preview and create it. Fails if the file already exists.', { path: string, content: string }, ['path', 'content']),
]

export function projectRelativePath(path: string): string {
  if (!path || path.length > 1024 || path.includes('\0') || /^(?:[a-z]:|[/\\])/i.test(path) || path.split(/[/\\]/).some(part => part === '..')) throw new Error('Use a project-relative path without parent traversal')
  return path.replace(/\\/g, '/')
}

export async function readLocalProjectFile(session: GoIDESession, rawPath: string): Promise<{ path: string; content: string }> {
  const path = projectRelativePath(rawPath)
  if (await getGoIDEAIPolicy(session.id) === 'off') throw new Error('AI is disabled for this project')
  if ((await listGoIDEAIExcludedPaths(session.id, [path], true)).length) throw new Error('File excluded by project AI rules')
  const current = useCodeStudioStore.getState().documents.find(item => item.document.sessionId === session.id && item.document.relativePath.replace(/\\/g, '/') === path)
  if (current) return { path, content: current.buffer }
  const opened = await openGoIDEDocument(session.id, path)
  try { return { path, content: opened.content } } finally { await closeGoIDEDocument(session.id, opened.document.id) }
}

export async function executeLocalTool(session: GoIDESession, call: LocalToolCall, propose: (edit: LocalEditProposal) => void): Promise<string> {
  if (await getGoIDEAIPolicy(session.id) === 'off') throw new Error('AI is disabled for this project')
  const args = JSON.parse(call.function.arguments) as Record<string, unknown>
  const value = (key: string) => { if (typeof args[key] !== 'string') throw new Error(`Missing ${key}`); return args[key] as string }
  const redactor = createAIRedactor()
  let result: unknown
  switch (call.function.name) {
    case 'list_project_files': {
      const files = await quickOpenGoIDEFiles(session.id, value('query').slice(0, 300), 60)
      const excluded = new Set(await listGoIDEAIExcludedPaths(session.id, files.map(file => file.relativePath), true))
      result = files.filter(file => !excluded.has(file.relativePath)).map(file => file.relativePath)
      break
    }
    case 'read_project_file': {
      const file = await readLocalProjectFile(session, value('path'))
      result = { path: file.path, content: file.content.slice(0, 16000), truncated: file.content.length > 16000 }
      break
    }
    case 'search_project_symbols': {
      const symbols = (await requestWorkspaceSymbols(session.id, value('query').slice(0, 300))).slice(0, 40)
      const excluded = new Set(await listGoIDEAIExcludedPaths(session.id, symbols.flatMap(symbol => symbol.location.relativePath ? [symbol.location.relativePath] : []), true))
      result = symbols.filter(symbol => symbol.location.relativePath && !excluded.has(symbol.location.relativePath)).map(symbol => ({ name: symbol.name, kind: symbol.kind, path: symbol.location.relativePath, range: symbol.location.range }))
      break
    }
    case 'propose_edit': {
      const file = await readLocalProjectFile(session, value('path')), before = value('before'), after = value('after')
      if (!before || before === after || file.content.split(before).length !== 2) throw new Error('The original text must match exactly once in the current file')
      if (file.content.length > 256000 || after.length > 64000) throw new Error('Propose a smaller edit')
      propose({ path: file.path, original: file.content, updated: file.content.replace(before, () => after) })
      result = { status: 'awaiting_user_review', path: file.path, applied: false }
      break
    }
    case 'propose_create_file': {
      const path = projectRelativePath(value('path')), content = value('content')
      if (content.length > 64000) throw new Error('Propose a smaller file')
      if ((await listGoIDEAIExcludedPaths(session.id, [path], true)).length) throw new Error('File excluded by project AI rules')
      if ((await quickOpenGoIDEFiles(session.id, path, 60)).some(file => file.relativePath.replace(/\\/g, '/') === path)) throw new Error('The file already exists: use propose_edit')
      propose({ path, original: '', updated: content, create: true })
      result = { status: 'awaiting_user_review', path, created: false }
      break
    }
    default: throw new Error(`Unsupported tool: ${call.function.name}`)
  }
  return redactor.redact(JSON.stringify(result)).slice(0, 24000)
}

export async function applyLocalProposal(session: GoIDESession, proposal: LocalEditProposal) {
  if (proposal.create) {
    // createGoIDEFiles never overwrites: a file created meanwhile makes the apply fail instead of losing it.
    await createGoIDEFiles(session.id, [{ relativePath: projectRelativePath(proposal.path), content: proposal.updated }])
    if (useCodeStudioStore.getState().activeSessionId === session.id) await useCodeStudioStore.getState().openDocument(proposal.path)
    return
  }
  const current = await readLocalProjectFile(session, proposal.path)
  if (current.content !== proposal.original) throw new Error('The file changed since this proposal. Ask for a new edit.')
  const store = useCodeStudioStore.getState()
  if (store.activeSessionId !== session.id) throw new Error('Switch back to this project before applying the edit')
  const id = await store.openDocument(proposal.path)
  if (!id) throw new Error('Could not open the target file')
  const opened = useCodeStudioStore.getState().documents.find(item => item.document.id === id)
  if (!opened || opened.buffer !== proposal.original || opened.document.readOnly) throw new Error('The target file changed or is read-only')
  useCodeStudioStore.getState().updateDocument(id, proposal.updated)
}
