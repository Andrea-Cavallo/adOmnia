import { createTemplateNodeMap, getAstFromContent, getContentFromTemplateNode } from '@onlook/parser'
import type { JsxElementMetadata } from '../vendor/packages/file-system/src/index-cache'
import { preserveFormatting } from './preserve-formatting'
import { injectIds, stripIds } from './source-ids'

/**
 * FileSystemAdapter: what the engine needs from the workspace. The real implementation
 * (workspace-io.ts) goes through the Code Studio document APIs, so the Go backend stays the
 * owner of paths, confinement, atomic writes and disk-version checks.
 */
export interface WorkspaceIO {
  /** Project-relative paths of the JSX/TSX sources, forward slashes. */
  list: () => Promise<string[]>
  read: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<void>
  /** Reports files whose content changed outside this adapter (Monaco edits, disk changes). */
  onChange?: (listener: (path: string) => void) => () => void
}

const JSX_FILE = /\.(jsx?|tsx?)$/i

export function isJsxFile(path: string): boolean {
  return JSX_FILE.test(path)
}

/** Rejects anything that is not a plain path inside the project: no absolute paths, no "..". */
export function assertProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) {
    throw new Error(`Not a project file: ${path}`)
  }
  if (normalized.split('/').some((part) => part === '..')) throw new Error(`Path leaves the project: ${path}`)
  return normalized
}

/** One file write of a visual edit: enough to take it back, or to apply it again, exactly. */
export interface Checkpoint {
  path: string
  before: string
  after: string
}

export interface IdPlan {
  /** Files that have no ids yet, or incomplete ones. */
  pending: string[]
  total: number
}

/**
 * The engine's code editor over an adOmnia workspace: reads and writes source files and keeps
 * the element index (id → file, range, component) the managers query. Indexing itself is the
 * transplanted `createTemplateNodeMap`; this class owns freshness and persistence only.
 */
export class WorkspaceCodeEditor {
  private readonly index = new Map<string, JsxElementMetadata>()
  private readonly idsByPath = new Map<string, string[]>()
  private readonly indexedContent = new Map<string, string>()
  private readonly stale = new Set<string>()
  private stopListening: (() => void) | null = null
  /** Receives every write of a visual edit (HistoryAdapter); null while a checkpoint is being restored. */
  recorder: ((checkpoint: Checkpoint) => void) | null = null

  constructor(private readonly branchId: string, private readonly io: WorkspaceIO) {
    this.stopListening = io.onChange?.((path) => {
      if (this.indexedContent.has(path) || isJsxFile(path)) this.stale.add(path)
    }) ?? null
  }

  async readFile(path: string): Promise<string | Uint8Array> {
    return this.io.read(assertProjectPath(path))
  }

  async writeFile(path: string, content: string): Promise<void> {
    const target = assertProjectPath(path)
    let next = content
    const current = await this.io.read(target).catch(() => null)
    if (isJsxFile(target)) {
      // The engine hands over a regenerated file: keep the formatting of the lines it did not edit.
      if (current !== null) next = await preserveFormatting(current, next)
      next = (await injectIds(next, this.idsOutside(target))).content
    }
    await this.io.write(target, next)
    await this.indexFile(target, next)
    this.stale.delete(target)
    if (current !== null && current !== next) this.recorder?.({ path: target, before: current, after: next })
  }

  /**
   * Puts the files of a visual edit back to one side of its checkpoints. Nothing is written
   * unless every file still holds exactly the other side: a file edited since is never overwritten.
   */
  async restore(checkpoints: readonly Checkpoint[], side: 'before' | 'after'): Promise<boolean> {
    const other = side === 'before' ? 'after' : 'before'
    const contents = await Promise.all(checkpoints.map((checkpoint) => this.io.read(checkpoint.path).catch(() => null)))
    if (checkpoints.length === 0 || contents.some((content, index) => content !== checkpoints[index]?.[other])) return false
    for (const checkpoint of side === 'before' ? [...checkpoints].reverse() : checkpoints) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential: each write is checked against the disk version
      await this.io.write(checkpoint.path, checkpoint[side])
      // oxlint-disable-next-line eslint/no-await-in-loop
      await this.indexFile(checkpoint.path, checkpoint[side])
      this.stale.delete(checkpoint.path)
    }
    return true
  }

  async getJsxElementMetadata(oid: string): Promise<JsxElementMetadata | undefined> {
    await this.refreshStale()
    return this.index.get(oid)
  }

  /** Reads every source and indexes the ids already present; reports the files that need ids. */
  async scan(): Promise<IdPlan> {
    const paths = (await this.io.list()).map(assertProjectPath).filter(isJsxFile)
    const pending: string[] = []
    for (const path of paths) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: one bridge call at a time keeps the UI responsive
      const content = await this.io.read(path).catch(() => null)
      if (content === null) continue
      // oxlint-disable-next-line eslint/no-await-in-loop
      await this.indexFile(path, content)
      // oxlint-disable-next-line eslint/no-await-in-loop
      if ((await injectIds(content, new Set())).modified) pending.push(path)
    }
    return { pending, total: paths.length }
  }

  /** Writes the ids into the given files. Returns the files that could not be written. */
  async addIds(paths: string[]): Promise<string[]> {
    const failed: string[] = []
    for (const path of paths) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential: each write is checked against the disk version
        await this.writeFile(path, await this.io.read(path))
      } catch {
        failed.push(path)
      }
    }
    return failed
  }

  /** Removes the ids from every indexed file. Returns the files that could not be written. */
  async removeIds(): Promise<string[]> {
    const failed: string[] = []
    for (const path of Array.from(this.indexedContent.keys())) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const stripped = stripIds(await this.io.read(path))
        // oxlint-disable-next-line eslint/no-await-in-loop
        if (stripped.modified) await this.io.write(path, stripped.content)
        this.forget(path)
      } catch {
        failed.push(path)
      }
    }
    return failed
  }

  get size(): number {
    return this.index.size
  }

  dispose() {
    this.stopListening?.()
    this.stopListening = null
    this.index.clear()
    this.idsByPath.clear()
    this.indexedContent.clear()
    this.stale.clear()
  }

  private async refreshStale() {
    if (this.stale.size === 0) return
    const paths = Array.from(this.stale)
    this.stale.clear()
    await Promise.all(paths.map(async (path) => {
      const content = await this.io.read(path).catch(() => null)
      if (content === null) this.forget(path)
      else if (content !== this.indexedContent.get(path)) await this.indexFile(path, content)
    }))
  }

  private idsOutside(path: string): Set<string> {
    const own = new Set(this.idsByPath.get(path) ?? [])
    const ids = new Set<string>()
    for (const oid of this.index.keys()) if (!own.has(oid)) ids.add(oid)
    return ids
  }

  private forget(path: string) {
    for (const oid of this.idsByPath.get(path) ?? []) {
      if (this.index.get(oid)?.path === path) this.index.delete(oid)
    }
    this.idsByPath.delete(path)
    this.indexedContent.delete(path)
  }

  private async indexFile(path: string, content: string) {
    this.forget(path)
    this.indexedContent.set(path, content)
    const ast = getAstFromContent(content)
    if (!ast) return
    const nodes = createTemplateNodeMap({ ast, filename: path, branchId: this.branchId })
    const oids: string[] = []
    for (const [oid, node] of nodes) {
      oids.push(oid)
      // oxlint-disable-next-line eslint/no-await-in-loop -- the transplanted helper is async but does no I/O
      this.index.set(oid, { ...node, oid, code: (await getContentFromTemplateNode(node, content)) ?? '' })
    }
    this.idsByPath.set(path, oids)
  }
}
