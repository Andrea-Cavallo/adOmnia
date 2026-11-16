import { describe, expect, it } from 'vitest'
import { CodeActionType, StyleChangeType, type Action } from '@onlook/models'
import { EditorEngine } from '@ve-client/components/store/editor/engine'
import { WorkspaceCodeEditor, assertProjectPath, type WorkspaceIO } from './file-system'
import { DesignSession } from './design-session'
import { noAnalytics } from './host'
import { injectIds, stripIds } from './source-ids'

const SESSION = 'session-1'

function memoryIO(files: Record<string, string>): WorkspaceIO & { files: Record<string, string>; touch: (path: string, content: string) => void } {
  const listeners = new Set<(path: string) => void>()
  return {
    files,
    list: async () => Object.keys(files),
    read: async (path) => {
      const content = files[path]
      if (content === undefined) throw new Error(`missing ${path}`)
      return content
    },
    write: async (path, content) => { files[path] = content },
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    touch(path, content) { files[path] = content; listeners.forEach((listener) => listener(path)) },
  }
}

const APP = `import { Card } from './Card'

// The landing page.
export function App() {
  return (
    <main className="p-4">
      <h1 className='text-xl'>Hello</h1>
      <Card title="One" />
      <p>World</p>
    </main>
  )
}
`

function oidOf(source: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*data-oid="([^"]+)"`).exec(source)
  if (!match?.[1]) throw new Error(`no id on <${tag}>`)
  return match[1]
}

async function setup(files: Record<string, string> = { 'src/App.tsx': APP }) {
  const io = memoryIO(files)
  const editor = new WorkspaceCodeEditor(SESSION, io)
  const plan = await editor.scan()
  await editor.addIds(plan.pending)
  const engine = new EditorEngine(SESSION, noAnalytics, editor)
  return { io, editor, engine, plan }
}

describe('source ids', () => {
  it('adds an id to every element and leaves the rest of the file untouched', async () => {
    const result = await injectIds(APP, new Set())
    expect(result.modified).toBe(true)
    expect(stripIds(result.content).content).toBe(APP)
    expect(result.content.match(/data-oid="/g)).toHaveLength(4)
    expect(result.content).toContain("className='text-xl' data-oid=")
    expect(result.content).toContain('// The landing page.')
  })

  it('is stable: a file that already has ids is not modified again', async () => {
    const once = await injectIds(APP, new Set())
    const twice = await injectIds(once.content, new Set())
    expect(twice.modified).toBe(false)
    expect(twice.content).toBe(once.content)
  })

  it('replaces a duplicated id and never reuses an id known elsewhere', async () => {
    const source = 'export const A = () => <div data-oid="dup"><span data-oid="dup" /></div>\n'
    const result = await injectIds(source, new Set(['dup']))
    const ids = Array.from(result.content.matchAll(/data-oid="([^"]+)"/g), (match) => match[1])
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe('dup')
  })

  it('leaves a file that does not parse alone', async () => {
    const broken = 'export const A = () => <div>'
    expect(await injectIds(broken, new Set())).toEqual({ content: broken, modified: false })
  })
})

describe('project paths', () => {
  it.each(['../secret.tsx', 'src/../../x.tsx', '/etc/passwd', 'C:\\Windows\\x.tsx', 'C:/Windows/x.tsx', '', 'src\\..\\..\\x.tsx'])('rejects %s', (path) => {
    expect(() => assertProjectPath(path)).toThrow()
  })

  it('normalizes separators of a path inside the project', () => {
    expect(assertProjectPath('src\\components\\App.tsx')).toBe('src/components/App.tsx')
  })

  it('refuses to write outside the project', async () => {
    const { editor, io } = await setup()
    await expect(editor.writeFile('../outside.tsx', 'x')).rejects.toThrow()
    expect(Object.keys(io.files)).toEqual(['src/App.tsx'])
  })
})

describe('element index (DOM id → source)', () => {
  it('maps an id to its file, position and component', async () => {
    const { editor, io, plan } = await setup()
    expect(plan).toEqual({ pending: ['src/App.tsx'], total: 1 })
    const source = io.files['src/App.tsx'] ?? ''
    const meta = await editor.getJsxElementMetadata(oidOf(source, 'h1'))
    expect(meta?.path).toBe('src/App.tsx')
    expect(meta?.component).toBe('App')
    expect(meta?.startTag.start.line).toBe(7)
    expect(meta?.code).toContain('Hello</h1>')
  })

  it('follows edits made outside the adapter (Monaco, disk)', async () => {
    const { editor, io } = await setup()
    const source = io.files['src/App.tsx'] ?? ''
    const oid = oidOf(source, 'p')
    io.touch('src/App.tsx', `// moved down\n\n${source}`)
    expect((await editor.getJsxElementMetadata(oid))?.startTag.start.line).toBe(11)
  })

  it('does not resolve an id whose element was deleted from the source', async () => {
    const { editor, io } = await setup()
    const source = io.files['src/App.tsx'] ?? ''
    const oid = oidOf(source, 'p')
    io.touch('src/App.tsx', source.replace(/\s*<p[^>]*>World<\/p>/, ''))
    expect(await editor.getJsxElementMetadata(oid)).toBeUndefined()
  })

  it('removes the ids again, restoring the original file', async () => {
    const { editor, io } = await setup()
    expect(await editor.removeIds()).toEqual([])
    expect(io.files['src/App.tsx']).toBe(APP)
  })
})

describe('visual edits reach the source file', () => {
  const target = (oid: string) => ({ frameId: 'frame', branchId: SESSION, domId: 'dom', oid })

  it('style change → Tailwind classes merged into className', async () => {
    const { engine, io } = await setup()
    const oid = oidOf(io.files['src/App.tsx'] ?? '', 'h1')
    await engine.code.write({
      type: 'update-style',
      targets: [{ ...target(oid), change: { original: {}, updated: { color: { value: '#ff0000', type: StyleChangeType.Value }, fontSize: { value: '24px', type: StyleChangeType.Value } } } }],
    })
    const h1 = /<h1[^>]*>/.exec(io.files['src/App.tsx'] ?? '')?.[0] ?? ''
    expect(h1).toContain('text-[#ff0000]')
    expect(h1).toContain('text-[24px]')
    expect(h1).not.toContain('text-xl')
    expect(io.files['src/App.tsx']).toContain('// The landing page.')
    expect(io.files['src/App.tsx']).toContain("import { Card } from './Card'")
  })

  it('text change → JSX text', async () => {
    const { engine, io } = await setup()
    const oid = oidOf(io.files['src/App.tsx'] ?? '', 'p')
    await engine.code.write({ type: 'edit-text', targets: [target(oid)], originalContent: 'World', newContent: 'Everyone' })
    expect(io.files['src/App.tsx']).toMatch(/<p[^>]*>Everyone<\/p>/)
  })

  it('insert, move and remove, each undone by the history', async () => {
    const { engine, io } = await setup()
    const before = io.files['src/App.tsx'] ?? ''
    const main = oidOf(before, 'main')
    const location = { type: 'index' as const, targetDomId: 'dom-main', targetOid: main, index: 0, originalIndex: 0 }
    const element = { oid: 'new-el', domId: 'dom-new', tagName: 'div', attributes: {}, styles: {}, textContent: 'Fresh', children: [], frameId: 'frame', branchId: SESSION }

    const insert: Action = { type: 'insert-element', targets: [target('new-el')], location, element, editText: false, pasteParams: null, codeBlock: null }
    await engine.history.push(insert)
    const inserted = io.files['src/App.tsx'] ?? ''
    expect(inserted).toMatch(/<main[^>]*>\s*<div[^>]*data-oid="new-el"[^>]*>Fresh<\/div>\s*<h1/)

    const undo = engine.history.undo()
    expect(undo?.type).toBe('remove-element')
    if (undo) await engine.code.write(undo)
    expect(io.files['src/App.tsx']).not.toContain('new-el')

    const redo = engine.history.redo()
    if (redo) await engine.code.write(redo)
    expect(io.files['src/App.tsx']).toContain('data-oid="new-el"')

    const p = oidOf(io.files['src/App.tsx'] ?? '', 'p')
    await engine.code.write({ type: 'move-element', targets: [target(p)], location: { ...location, index: 0, originalIndex: 3 } })
    expect(io.files['src/App.tsx']).toMatch(/<main[^>]*>\s*<p[^>]*>World<\/p>/)

    await engine.code.write({ type: 'remove-element', targets: [target(p)], location, element: { ...element, oid: p }, editText: false, pasteParams: null, codeBlock: null })
    expect(io.files['src/App.tsx']).not.toContain('World')
    expect(CodeActionType.REMOVE).toBe('remove')
  })

  it('never writes when the id cannot be mapped to a source file', async () => {
    const { engine, io } = await setup()
    const before = io.files['src/App.tsx']
    await engine.code.write({ type: 'edit-text', targets: [target('unknown-id')], originalContent: 'a', newContent: 'b' })
    expect(io.files['src/App.tsx']).toBe(before)
  })
})

describe('formatting of untouched lines', () => {
  const STYLED = `import { Card } from './Card'

// No semicolons, single quotes: the project's own style.
export function App() {
  const items = [1, 2]
  return (
    <main className="p-4">
      <h1 className='text-xl'>Hello</h1>
      {items.map((item) => (
        <Card key={item} title="One" />
      ))}
      <p>
        World
      </p>
    </main>
  )
}
`

  it('a style edit changes only the edited line', async () => {
    const { engine, io } = await setup({ 'src/App.tsx': STYLED })
    const before = io.files['src/App.tsx'] ?? ''
    const oid = oidOf(before, 'h1')
    await engine.code.write({
      type: 'update-style',
      targets: [{ frameId: 'frame', branchId: SESSION, domId: 'dom', oid, change: { original: {}, updated: { fontSize: { value: '24px', type: StyleChangeType.Value } } } }],
    })
    const after = io.files['src/App.tsx'] ?? ''
    const beforeLines = before.split('\n')
    const afterLines = after.split('\n')
    expect(afterLines).toHaveLength(beforeLines.length)
    const changed = afterLines.filter((line, index) => line !== beforeLines[index])
    expect(changed).toHaveLength(1)
    expect(changed[0]).toContain('text-[24px]')
    expect(after.endsWith('}\n')).toBe(true)
  })

  it('keeps CRLF line endings', async () => {
    const { engine, io } = await setup({ 'src/App.tsx': STYLED.replace(/\n/g, '\r\n') })
    const oid = oidOf(io.files['src/App.tsx'] ?? '', 'h1')
    await engine.code.write({ type: 'edit-text', targets: [{ frameId: 'frame', branchId: SESSION, domId: 'dom', oid }], originalContent: 'Hello', newContent: 'Hi  there' })
    const after = io.files['src/App.tsx'] ?? ''
    expect(after).toContain('>Hi  there</h1>')
    expect(after.split('\r\n')).toHaveLength(STYLED.split('\n').length)
    expect(after.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('history checkpoints', () => {
  const style = (oid: string, fontSize: string): Action => ({
    type: 'update-style',
    targets: [{ frameId: 'frame', branchId: SESSION, domId: 'dom', oid, change: { original: { fontSize: { value: '20px', type: StyleChangeType.Value } }, updated: { fontSize: { value: fontSize, type: StyleChangeType.Value } } } }],
  })

  async function designSession() {
    const io = memoryIO({ 'src/App.tsx': APP })
    const session = new DesignSession(SESSION, '.', io)
    await session.prepare()
    await session.addIds()
    return { io, session }
  }

  it('undo restores the exact source, redo applies the edit again', async () => {
    const { io, session } = await designSession()
    const before = io.files['src/App.tsx'] ?? ''
    await session.engine.history.push(style(oidOf(before, 'h1'), '24px'))
    const edited = io.files['src/App.tsx'] ?? ''
    expect(edited).toContain('text-[24px]')

    await session.undo()
    expect(io.files['src/App.tsx']).toBe(before)
    await session.redo()
    expect(io.files['src/App.tsx']).toBe(edited)
    session.dispose()
  })

  it('never overwrites a file that was edited after the visual change', async () => {
    const { io, session } = await designSession()
    await session.engine.history.push(style(oidOf(io.files['src/App.tsx'] ?? '', 'h1'), '24px'))
    io.touch('src/App.tsx', (io.files['src/App.tsx'] ?? '').replace('World', 'Typed in the editor'))

    await session.undo()
    const after = io.files['src/App.tsx'] ?? ''
    expect(after).toContain('Typed in the editor')
    expect(after).not.toContain('text-[24px]')
    expect(after).toContain('text-[20px]')
    session.dispose()
  })
})
