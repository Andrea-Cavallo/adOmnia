import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle,
  Download,
  Eye,
  FileWarning,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitFork,
  GitMerge,
  GitPullRequest,
  Loader2,
  Minus,
  Plus,
  Pin,
  RefreshCw,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { cn } from '@/lib/utils'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { safeSelectFolder } from '@/lib/fileUtils'
import { addRepo, loadLastRepo, loadPinnedBranches, loadRepos, removeRepo, saveLastRepo, toggleBranchPin, toggleRepoPin, type SavedRepo } from '@/lib/gitRepos'
import { exportCollectionToFolder, exportRequestToFolder, hasCollectionFSBinding, importCollectionFromFolder, inspectCollectionFolder } from '@/lib/collectionfs-api'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { GitCompareTab } from './GitCompareTab'
import { GitActionsTab } from './GitActionsTab'
import { DiffModal } from '@/components/response/DiffView'
import { GitGraphActions, type CommitMenuRequest, type FileMenuRequest } from './git/GitGraphActions'
import { HistorySearchBar } from './git/HistorySearchBar'
import { GitCommitGraph } from './git/GitCommitGraph'
import { HunkStageDialog } from './git/HunkStageDialog'
import { TextResultDialog } from './git/dialogs'
import type { CommitInfo as GitCommitInfo } from '@/lib/git/types'
import { buildGitGraphLayout } from '@/lib/git/graphLayout'
import { aiActionTitle, runAiCommitAnalysis, type AiActionId } from '@/lib/git/aiCommitAnalysis'

interface GitStatus {
  branch: string
  dirty: boolean
  aheadCount: number
  behindCount: number
  modified: string[]
  untracked: string[]
}

interface FileChange {
  path: string
  index: string
  worktree: string
  status: string
  conflicted: boolean
}

interface BranchInfo {
  name: string
  remote: boolean
  current: boolean
  upstream: string
  commitHash: string
  updated: string
}

interface RemoteInfo {
  name: string
  url: string
}

interface CommitInfo {
  hash: string
  fullHash: string
  parents: string[]
  author: string
  date: string
  message: string
  decorations: string[]
}

interface GitOverview {
  status: GitStatus
  changes: FileChange[]
  conflicts: FileChange[]
  branches: BranchInfo[]
  remotes: RemoteInfo[]
  stashes: string[]
  commits: CommitInfo[]
}

interface CommitChangedFile {
  status: string
  path: string
  oldPath?: string
}

interface WorkingTreeFileSnapshot {
  path: string
  oldPath?: string
  oldContent: string
  newContent: string
  diff: string
}

type GitDragPayload = { type: 'branch'; name: string } | { type: 'commit'; hash: string }

const emptyStatus: GitStatus = { branch: '', dirty: false, aheadCount: 0, behindCount: 0, modified: [], untracked: [] }
const EMPTY_TREE_REF = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// Resizable columns for the Sync tab — same grip + clamp behavior as the API
// Workspace, Markdown Notes, and LaTeX Studio. Widths persist across sessions.
type GitColumnKey = 'sidebar' | 'commitPanel'
type GitColumnWidths = Record<GitColumnKey, number>

const GIT_COLUMNS_KEY = 'adomnia.gitsync.columns'

const DEFAULT_GIT_COLUMN_WIDTHS: GitColumnWidths = {
  sidebar: 256,
  commitPanel: 320,
}

const GIT_COLUMN_LIMITS: Record<GitColumnKey, { min: number; maxRatio: number }> = {
  sidebar: { min: 192, maxRatio: 0.42 },
  commitPanel: { min: 256, maxRatio: 0.48 },
}

function clampGitColumnWidth(key: GitColumnKey, width: number): number {
  const limit = GIT_COLUMN_LIMITS[key]
  return Math.max(limit.min, Math.min(width, Math.round(window.innerWidth * limit.maxRatio)))
}

function loadGitColumnWidths(): GitColumnWidths {
  try {
    const raw = window.localStorage.getItem(GIT_COLUMNS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<GitColumnWidths>) : {}
    return {
      sidebar: clampGitColumnWidth('sidebar', parsed.sidebar ?? DEFAULT_GIT_COLUMN_WIDTHS.sidebar),
      commitPanel: clampGitColumnWidth('commitPanel', parsed.commitPanel ?? DEFAULT_GIT_COLUMN_WIDTHS.commitPanel),
    }
  } catch {
    return { ...DEFAULT_GIT_COLUMN_WIDTHS }
  }
}

function hasGitSyncBinding(): boolean {
  const w = window as typeof window & { go?: { main?: { GitSync?: unknown } } }
  return Boolean(w.go?.main?.GitSync)
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function changeLabel(change: FileChange): string {
  if (change.conflicted) return 'Conflict'
  if (change.status === '??') return 'Untracked'
  if (change.index === 'A' || change.worktree === 'A') return 'Added'
  if (change.index === 'D' || change.worktree === 'D') return 'Deleted'
  if (change.index === 'R' || change.worktree === 'R') return 'Renamed'
  return 'Modified'
}

function changedFileLabel(status: string): string {
  if (status === 'A') return 'Added'
  if (status === 'D') return 'Deleted'
  if (status === 'R') return 'Renamed'
  if (status === 'C') return 'Copied'
  if (status === 'U') return 'Conflict'
  return 'Modified'
}

function changedFileClass(status: string): string {
  if (status === 'A') return 'bg-success/15 text-success'
  if (status === 'D') return 'bg-error/15 text-error'
  if (status === 'R' || status === 'C') return 'bg-accent/15 text-accent'
  if (status === 'U') return 'bg-warning/15 text-warning'
  return 'bg-surface-3 text-text-3'
}

function extractOldContent(diff: string): string {
  if (!diff) return '(empty or binary file)'
  return diff
    .split('\n')
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---') && !line.startsWith('@@') && !line.startsWith('diff') && !line.startsWith('index'))
    .filter((line) => line.startsWith(' ') || line.startsWith('-'))
    .map((line) => line.slice(1))
    .join('\n')
}

function extractNewContent(diff: string): string {
  if (!diff) return '(empty or binary file)'
  return diff
    .split('\n')
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---') && !line.startsWith('@@') && !line.startsWith('diff') && !line.startsWith('index'))
    .filter((line) => line.startsWith(' ') || line.startsWith('+'))
    .map((line) => line.slice(1))
    .join('\n')
}

function normalizeCommit(commit: Partial<CommitInfo>): CommitInfo {
  return {
    hash: commit.hash ?? '',
    fullHash: commit.fullHash ?? commit.hash ?? '',
    parents: Array.isArray(commit.parents) ? commit.parents : [],
    author: commit.author ?? '',
    date: commit.date ?? '',
    message: commit.message ?? '',
    decorations: Array.isArray(commit.decorations) ? commit.decorations : [],
  }
}

function normalizeBranch(branch: Partial<BranchInfo>): BranchInfo {
  return {
    name: branch.name ?? '',
    remote: branch.remote ?? false,
    current: branch.current ?? false,
    upstream: branch.upstream ?? '',
    commitHash: branch.commitHash ?? '',
    updated: branch.updated ?? '',
  }
}

function normalizeChange(change: Partial<FileChange>): FileChange {
  return {
    path: change.path ?? '',
    index: change.index ?? '',
    worktree: change.worktree ?? '',
    status: change.status ?? '',
    conflicted: change.conflicted ?? false,
  }
}

function shortBranch(name: string): string {
  return name.replace(/^remotes\//, '').replace(/^origin\//, '')
}

function downloadSafeName(path: string, suffix: string): string {
  const leaf = path.split(/[\\/]/).pop() || 'file'
  return `${leaf}.${suffix}`
}

function safeFolderSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'collection'
}

function collectionFolderPath(repoPath: string, collectionId: string, collectionName: string): string {
  const root = repoPath.replace(/[\\/]+$/, '')
  const leaf = `${safeFolderSegment(collectionName)}-${safeFolderSegment(collectionId)}`
  return `${root}/adomnia-collections/${leaf}`
}

export function GitSyncPanel() {
  const environments = useEnvironmentsStore((state) => state.environments)
  const tabs = useTabsStore((state) => state.tabs)
  const activeTabId = useTabsStore((state) => state.activeTabId)
  const collections = useCollectionsStore((state) => state.collections)
  const importCollection = useCollectionsStore((state) => state.importCollection)
  const [repoPath, setRepoPath] = useState(() => loadLastRepo())
  const [repos, setRepos] = useState<SavedRepo[]>(() => loadRepos())
  const [pinnedBranches, setPinnedBranches] = useState<string[]>(() => loadPinnedBranches(loadLastRepo()))
  const [commitMsg, setCommitMsg] = useState('')
  const [hunkTarget, setHunkTarget] = useState<{ path: string; mode: 'stage' | 'unstage' } | null>(null)
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [selectedHash, setSelectedHash] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState<'sync' | 'actions' | 'compare'>('sync')
  const [commitFiles, setCommitFiles] = useState<CommitChangedFile[]>([])
  const [commitFilesLoading, setCommitFilesLoading] = useState(false)
  const [commitDiffFile, setCommitDiffFile] = useState<CommitChangedFile | null>(null)
  const [commitDiffText, setCommitDiffText] = useState('')
  const [workingDiffFile, setWorkingDiffFile] = useState<FileChange | null>(null)
  const [workingDiffSnapshot, setWorkingDiffSnapshot] = useState<WorkingTreeFileSnapshot | null>(null)
  const [workingDiffLoadingPath, setWorkingDiffLoadingPath] = useState('')
  // Commit-graph operations: multi-selection, context menus, structured search.
  const [selectedHashes, setSelectedHashes] = useState<string[]>([])
  const [commitMenu, setCommitMenu] = useState<CommitMenuRequest | null>(null)
  const [fileMenu, setFileMenu] = useState<FileMenuRequest | null>(null)
  const [searchResults, setSearchResults] = useState<GitCommitInfo[] | null>(null)
  const [aiBusy, setAiBusy] = useState('')
  const [aiBaseBranch, setAiBaseBranch] = useState('')
  const [aiResult, setAiResult] = useState<{ title: string; text: string } | null>(null)
  const [repoSummaries, setRepoSummaries] = useState<Record<string, GitStatus>>({})
  const [loadingRepoSummaries, setLoadingRepoSummaries] = useState(false)
  const [dragPayload, setDragPayload] = useState<GitDragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<{ payload: GitDragPayload; branch: string } | null>(null)
  const [dragFile, setDragFile] = useState<{ path: string; mode: 'stage' | 'unstage' } | null>(null)
  const [commitLimit, setCommitLimit] = useState(240)
  const [selectedCollectionId, setSelectedCollectionId] = useState('')
  const [graphScrollTop, setGraphScrollTop] = useState(0)
  const [graphViewportHeight, setGraphViewportHeight] = useState(600)
  const graphScrollRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const [columnWidths, setColumnWidths] = useState<GitColumnWidths>(() => loadGitColumnWidths())
  const columnResizeRef = useRef<{ key: GitColumnKey; startX: number; startWidth: number; direction: 1 | -1 } | null>(null)

  const status = overview?.status ?? emptyStatus
  const selectedCommit = useMemo(
    () => overview?.commits.find((commit) => commit.hash === selectedHash) ?? overview?.commits[0],
    [overview, selectedHash],
  )
  const localBranches = useMemo(() => overview?.branches.filter((branch) => !branch.remote) ?? [], [overview])
  const remoteBranches = useMemo(() => overview?.branches.filter((branch) => branch.remote) ?? [], [overview])
  const aiBaseChoices = useMemo(() => localBranches.filter((branch) => !branch.current), [localBranches])
  const sortedRepos = useMemo(() => [...repos].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.addedAt - a.addedAt), [repos])
  const sortedLocalBranches = useMemo(() => [...localBranches].sort((a, b) => Number(pinnedBranches.includes(b.name)) - Number(pinnedBranches.includes(a.name)) || Number(b.current) - Number(a.current) || a.name.localeCompare(b.name)), [localBranches, pinnedBranches])
  const sortedRemoteBranches = useMemo(() => [...remoteBranches].sort((a, b) => Number(pinnedBranches.includes(b.name)) - Number(pinnedBranches.includes(a.name)) || a.name.localeCompare(b.name)), [remoteBranches, pinnedBranches])
  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? collections[0] ?? null,
    [collections, selectedCollectionId],
  )
  const activeCollectionRequest = useMemo(() => {
    const tab = tabs.find((candidate) => candidate.id === activeTabId)
    return tab?.collectionId === selectedCollection?.id ? tab.request : null
  }, [activeTabId, selectedCollection?.id, tabs])
  const targetCollectionFolder = useMemo(
    () => repoPath && selectedCollection ? collectionFolderPath(repoPath, selectedCollection.id, selectedCollection.name) : '',
    [repoPath, selectedCollection],
  )
  const selectedAiBase = aiBaseBranch || aiBaseChoices.find((branch) => ['main', 'master', 'develop'].includes(branch.name))?.name || aiBaseChoices[0]?.name || ''
  const filteredCommits = useMemo(() => {
    // Structured search results (when active) replace the default commit list.
    const commits = searchResults ?? overview?.commits ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return commits
    return commits.filter((commit) =>
      [commit.hash, commit.author, commit.message, ...commit.decorations].some((value) => value.toLowerCase().includes(needle)),
    )
  }, [overview, query, searchResults])
  const graphLayout = useMemo(
    () => buildGitGraphLayout(filteredCommits as GitCommitInfo[]),
    [filteredCommits],
  )
  const graphColumnWidth = Math.max(104, graphLayout.width)
  const graphGridStyle = { gridTemplateColumns: `${graphColumnWidth}px minmax(0, 1fr) 96px` }
  const graphWindow = useMemo(() => {
    const rowHeight = 58
    const overscan = 8
    const start = Math.max(0, Math.floor(graphScrollTop / rowHeight) - overscan)
    const end = Math.min(filteredCommits.length, Math.ceil((graphScrollTop + graphViewportHeight) / rowHeight) + overscan)
    return { start, end, rowHeight, commits: filteredCommits.slice(start, end) }
  }, [filteredCommits, graphScrollTop, graphViewportHeight])

  const selectedCommitBaseRef = selectedCommit?.parents[0] || EMPTY_TREE_REF

  useEffect(() => {
    if (!hasGitSyncBinding()) {
      setGitAvailable(false)
      return
    }
    try {
      GitSync.IsGitInstalled().then(setGitAvailable).catch(() => setGitAvailable(false))
    } catch {
      setGitAvailable(false)
    }
  }, [])

  useEffect(() => {
    setPinnedBranches(loadPinnedBranches(repoPath))
  }, [repoPath])

  useEffect(() => {
    if (!collections.length) {
      setSelectedCollectionId('')
      return
    }
    if (!collections.some((collection) => collection.id === selectedCollectionId)) {
      setSelectedCollectionId(collections[0].id)
    }
  }, [collections, selectedCollectionId])

  useEffect(() => {
    const element = graphScrollRef.current
    if (!element) return
    const update = () => setGraphViewportHeight(element.clientHeight || 600)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [activeTab])

  const autoLoadedRef = useRef(false)
  useEffect(() => {
    if (gitAvailable !== true || autoLoadedRef.current) return
    autoLoadedRef.current = true
    if (repoPath) void refreshStatus(repoPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitAvailable])

  useEffect(() => {
    if (!repoPath || !selectedCommit || !hasGitSyncBinding()) {
      setCommitFiles([])
      return
    }
    let cancelled = false
    setCommitFilesLoading(true)
    setCommitFiles([])
    GitSync.CompareRefs(repoPath, selectedCommitBaseRef, selectedCommit.fullHash || selectedCommit.hash)
      .then((raw) => {
        if (cancelled) return
        setCommitFiles(parseJSON<CommitChangedFile[]>(raw, []))
      })
      .catch(() => {
        if (!cancelled) setCommitFiles([])
      })
      .finally(() => {
        if (!cancelled) setCommitFilesLoading(false)
      })
    return () => { cancelled = true }
  }, [repoPath, selectedCommit, selectedCommitBaseRef])

  useEffect(() => {
    try { window.localStorage.setItem(GIT_COLUMNS_KEY, JSON.stringify(columnWidths)) } catch { /* persistence is best-effort */ }
  }, [columnWidths])

  const startColumnResize = useCallback((key: GitColumnKey, direction: 1 | -1) => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    columnResizeRef.current = { key, startX: event.clientX, startWidth: columnWidths[key], direction }

    const handleMove = (moveEvent: MouseEvent) => {
      const drag = columnResizeRef.current
      if (!drag) return
      const nextWidth = clampGitColumnWidth(drag.key, drag.startWidth + (moveEvent.clientX - drag.startX) * drag.direction)
      setColumnWidths((current) => ({ ...current, [drag.key]: nextWidth }))
    }

    const handleUp = () => {
      columnResizeRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [columnWidths])

  const clearFeedback = () => { setError(''); setInfo('') }

  const refreshStatus = useCallback(async (overridePath?: string, overrideLimit?: number) => {
    const targetPath = (overridePath ?? repoPath).trim()
    if (!targetPath) return
    if (!hasGitSyncBinding()) {
      setError('Git Sync requires the desktop backend. Run inside Wails to use repository commands.')
      setLoading(false)
      return
    }
    clearFeedback()
    setLoading(true)
    try {
      const raw = await GitSync.Overview(targetPath, overrideLimit ?? commitLimit)
      const parsed = parseJSON<Partial<GitOverview>>(raw, {})
      // Backend nil slices can serialize as null; coerce every collection to an
      // array so render-time `.length`/`.map` never hit null.
      const next: GitOverview = {
        status: parsed.status
          ? {
              ...emptyStatus,
              ...parsed.status,
              modified: parsed.status.modified ?? [],
              untracked: parsed.status.untracked ?? [],
            }
          : emptyStatus,
        changes: (parsed.changes ?? []).map((change) => normalizeChange(change ?? {})),
        conflicts: (parsed.conflicts ?? []).map((change) => normalizeChange(change ?? {})),
        branches: (parsed.branches ?? []).map((branch) => normalizeBranch(branch ?? {})),
        remotes: (parsed.remotes ?? []).map((remote) => ({ name: remote?.name ?? '', url: remote?.url ?? '' })),
        stashes: parsed.stashes ?? [],
        commits: (parsed.commits ?? []).map((commit) => normalizeCommit(commit ?? {})),
      }
      setOverview(next)
      setSelectedHash((current) => current || next.commits[0]?.hash || '')
      // A successful overview load means the path is a real repo: remember it so
      // the user never has to re-import it and can switch back from the sidebar.
      setRepos((current) => addRepo(current, targetPath))
      saveLastRepo(targetPath)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [repoPath, commitLimit])

  const handleGraphScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    setGraphScrollTop(element.scrollTop)
    if (!loading && !loadingMoreRef.current && !searchResults && element.scrollHeight - element.scrollTop - element.clientHeight < 360 && (overview?.commits.length ?? 0) >= commitLimit) {
      const next = commitLimit + 240
      loadingMoreRef.current = true
      setCommitLimit(next)
      void refreshStatus(undefined, next).finally(() => { loadingMoreRef.current = false })
    }
  }

  const runAction = async (action: () => Promise<void>, success: string) => {
    if (!repoPath) return
    if (!hasGitSyncBinding()) {
      setError('Git Sync requires the desktop backend. Run inside Wails to use repository commands.')
      return
    }
    clearFeedback()
    setLoading(true)
    try {
      await action()
      setInfo(success)
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const selectRepo = useCallback((path: string) => {
    const trimmed = path.trim()
    if (!trimmed || trimmed === repoPath) {
      if (trimmed) void refreshStatus(trimmed)
      return
    }
    setRepoPath(trimmed)
    setOverview(null)
    setSelectedHash('')
    saveLastRepo(trimmed)
    void refreshStatus(trimmed)
  }, [repoPath, refreshStatus])

  const browseFolder = useCallback(async () => {
    try {
      const picked = await safeSelectFolder('Select a Git repository')
      if (picked) selectRepo(picked)
    } catch (e) {
      setError(String(e))
    }
  }, [selectRepo])

  const refreshAllRepoSummaries = async () => {
    if (!hasGitSyncBinding() || repos.length === 0) return
    setLoadingRepoSummaries(true)
    const entries = await Promise.all(repos.map(async (repo) => {
      try { return [repo.path, parseJSON<GitStatus>(await GitSync.GetStatus(repo.path), emptyStatus)] as const }
      catch { return [repo.path, { ...emptyStatus, branch: 'unavailable' }] as const }
    }))
    setRepoSummaries(Object.fromEntries(entries))
    setLoadingRepoSummaries(false)
  }

  const handleRemoveRepo = useCallback((event: React.MouseEvent, path: string) => {
    event.stopPropagation()
    setRepos((current) => removeRepo(current, path))
    if (path === repoPath) {
      setRepoPath('')
      setOverview(null)
      setSelectedHash('')
      saveLastRepo('')
    }
  }, [repoPath])

  const handleInit = () => runAction(
    () => GitSync.InitRepo(JSON.stringify({ repoPath, branch: status.branch || 'master' })),
    'Repository initialized.',
  )

  const changes = overview?.changes ?? []
  // Git's index model: a file with X (index) set is staged; a file with Y
  // (worktree) set is unstaged. `MM` appears in both. Conflicts live in their
  // own section above.
  const stagedFiles = useMemo(() => changes.filter((c) => !c.conflicted && c.index !== '' && c.index !== '?'), [changes])
  const unstagedFiles = useMemo(() => changes.filter((c) => !c.conflicted && c.worktree !== ''), [changes])

  const handleCommit = () => runAction(async () => {
    if (!commitMsg.trim() || stagedFiles.length === 0) return
    await GitSync.Commit(repoPath, commitMsg.trim())
    setCommitMsg('')
  }, 'Commit created.')

  const runCollectionFolderAction = async (action: () => Promise<string | void>, success: string) => {
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const result = await action()
      setInfo(result ?? success)
      if (repoPath && hasGitSyncBinding()) await refreshStatus(repoPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const exportSelectedCollection = () => runCollectionFolderAction(async () => {
    if (!repoPath) throw new Error('Repository path required')
    if (!selectedCollection) throw new Error('Select a collection first')
    await exportCollectionToFolder(targetCollectionFolder, selectedCollection, environments)
  }, selectedCollection ? `Exported "${selectedCollection.name}" to adomnia-collections.` : 'Collection exported.')

  const exportActiveRequest = () => runCollectionFolderAction(async () => {
    if (!repoPath || !selectedCollection) throw new Error('Select a collection first')
    if (!activeCollectionRequest) throw new Error('Open a request from the selected collection first')
    const path = await exportRequestToFolder(targetCollectionFolder, activeCollectionRequest)
    return `Exported ${path}.`
  }, 'Request exported.')

  const importCollectionFolder = () => runCollectionFolderAction(async () => {
    const folder = await safeSelectFolder('Select an adOmnia collection folder')
    if (!folder) return
    const imported = await importCollectionFromFolder(folder)
    const duplicate = useCollectionsStore.getState().collections.some((collection) => collection.name === imported.name)
    importCollection(duplicate
      ? { ...imported, id: `${imported.id}-${Date.now()}`, name: `${imported.name} Import` }
      : imported)
  }, 'Collection folder imported.')

  const inspectSelectedCollectionFolder = () => runCollectionFolderAction(async () => {
    if (!repoPath) throw new Error('Repository path required')
    if (!selectedCollection) throw new Error('Select a collection first')
    const report = await inspectCollectionFolder(targetCollectionFolder, selectedCollection)
    if (!report.inSync) {
      throw new Error(`Folder drift detected: ${report.requestCount} app requests / ${report.folderRequestCount} folder requests.`)
    }
    return `Folder in sync: ${report.requestCount} requests.`
  }, 'Folder in sync.')

  const cleanAiCommitMessage = (text: string) => {
    const fenced = text.match(/```(?:text)?\s*([\s\S]*?)```/i)?.[1]
    return (fenced || text).trim()
  }

  const runChangesAi = async (action: AiActionId, scope: 'staged' | 'working' | 'branch', baseRef = '', applyMessage = false) => {
    if (!repoPath) return
    setAiBusy(`${scope}:${action}`)
    clearFeedback()
    try {
      const diff = await GitSync.ChangesDiff(repoPath, scope, baseRef)
      const text = await runAiCommitAnalysis(action, {
        subject: scope === 'branch' ? `${status.branch} compared with ${baseRef}` : `${scope} changes`,
        body: '', author: 'Working tree', hash: scope === 'branch' ? status.branch : scope, diff,
      })
      if (applyMessage) setCommitMsg(cleanAiCommitMessage(text))
      else setAiResult({ title: scope === 'branch' ? `AI branch analysis — ${baseRef}…${status.branch}` : aiActionTitle(action), text })
    } catch (e) {
      setError(String(e))
    } finally {
      setAiBusy('')
    }
  }

  const stageFile = (path: string) => runAction(() => GitSync.StageFile(repoPath, path), 'File staged.')
  const unstageFile = (path: string) => runAction(() => GitSync.UnstageFile(repoPath, path), 'File unstaged.')
  const stageAll = () => runAction(() => GitSync.StageAll(repoPath), 'All changes staged.')
  const unstageAll = () => runAction(() => GitSync.UnstageAll(repoPath), 'All changes unstaged.')

  const renderChangeRow = (change: FileChange, mode: 'stage' | 'unstage') => {
    const isStaged = mode === 'unstage'
    const canHunk = (isStaged ? change.index : change.worktree) === 'M'
    return (
      <div
        key={`${mode}-${change.status}-${change.path}`}
        draggable
        onDragStart={() => setDragFile({ path: change.path, mode })}
        onDragEnd={() => setDragFile(null)}
        className="flex w-full items-center gap-1.5 rounded border border-border-1 bg-surface-0 px-2 py-1.5 transition-colors hover:border-accent/40 hover:bg-surface-2"
      >
        <button
          onClick={() => (isStaged ? unstageFile(change.path) : stageFile(change.path))}
          title={isStaged ? 'Unstage file' : 'Stage file'}
          className="shrink-0 rounded border border-border-2 p-0.5 text-text-3 hover:text-text-1"
        >
          {isStaged ? <Minus size={12} /> : <Plus size={12} />}
        </button>
        <button
          onClick={() => void openWorkingTreeDiff(change)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={`Open diff for ${change.path}`}
        >
          <span className={cn('w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px]', change.conflicted ? 'bg-warning/20 text-warning' : change.status === '??' ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-text-3')}>
            {changeLabel(change)}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2" title={change.path}>{change.path}</span>
          {workingDiffLoadingPath === change.path ? <Loader2 size={12} className="shrink-0 animate-spin text-accent" /> : <Eye size={12} className="shrink-0 text-text-4" />}
        </button>
        {canHunk && (
          <button
            onClick={() => setHunkTarget({ path: change.path, mode })}
            title={isStaged ? 'Unstage by hunk' : 'Stage by hunk'}
            className="shrink-0 rounded border border-border-2 p-0.5 text-text-3 hover:text-accent"
          >
            <Scissors size={12} />
          </button>
        )}
      </div>
    )
  }

  const openCommitDiff = async (file: CommitChangedFile) => {
    if (!repoPath || !selectedCommit) return
    if (!hasGitSyncBinding()) {
      setError('Git Sync requires the desktop backend. Run inside Wails to inspect diffs.')
      return
    }
    clearFeedback()
    try {
      const diff = await GitSync.GetFileDiff(repoPath, selectedCommitBaseRef, selectedCommit.fullHash || selectedCommit.hash, file.path)
      setCommitDiffFile(file)
      setCommitDiffText(diff)
    } catch (e) {
      setError(String(e))
    }
  }

  const openWorkingTreeDiff = async (change: FileChange) => {
    if (!repoPath) return
    if (!hasGitSyncBinding()) {
      setError('Git Sync requires the desktop backend. Run inside Wails to inspect diffs.')
      return
    }
    clearFeedback()
    setWorkingDiffLoadingPath(change.path)
    try {
      const raw = await GitSync.GetWorkingTreeFileSnapshot(repoPath, change.path, '')
      const snapshot = parseJSON<WorkingTreeFileSnapshot>(raw, {
        path: change.path,
        oldContent: '',
        newContent: '',
        diff: '',
      })
      setWorkingDiffFile(change)
      setWorkingDiffSnapshot(snapshot)
    } catch (e) {
      setError(String(e))
    } finally {
      setWorkingDiffLoadingPath('')
    }
  }

  const checkoutLocal = (name: string) => runAction(() => GitSync.CheckoutBranch(repoPath, name), `Switched to ${shortBranch(name)}.`)
  const checkoutRemote = (name: string) => runAction(() => GitSync.CheckoutRemoteBranch(repoPath, name), `Checked out ${shortBranch(name)} (tracking).`)
  const deleteLocal = (name: string) => {
    if (!window.confirm(`Delete local branch "${shortBranch(name)}"?`)) return
    void runAction(async () => {
      try {
        await GitSync.DeleteLocalBranch(repoPath, name, false)
      } catch {
        if (window.confirm(`"${shortBranch(name)}" may not be fully merged. Force delete?`)) {
          await GitSync.DeleteLocalBranch(repoPath, name, true)
        } else {
          throw new Error('Deletion cancelled.')
        }
      }
    }, `Deleted branch ${shortBranch(name)}.`)
  }
  const deleteRemote = (name: string) => {
    const stripped = name.replace(/^remotes\//, '')
    const slash = stripped.indexOf('/')
    const remote = slash >= 0 ? stripped.slice(0, slash) : 'origin'
    const branch = slash >= 0 ? stripped.slice(slash + 1) : stripped
    if (!window.confirm(`Delete "${branch}" on remote "${remote}"? This affects everyone using it.`)) return
    void runAction(() => GitSync.DeleteRemoteBranch(repoPath, remote, branch), `Deleted ${remote}/${branch}.`)
  }

  const executeDrop = (operation: 'merge' | 'rebase' | 'cherry-pick') => {
    if (!dropTarget) return
    const { payload, branch } = dropTarget
    setDropTarget(null)
    void runAction(async () => {
      if (status.branch !== branch) await GitSync.CheckoutBranch(repoPath, branch)
      if (payload.type === 'branch') {
        if (operation === 'merge') await GitSync.MergeBranch(repoPath, payload.name)
        else await GitSync.RebaseBranch(repoPath, payload.name)
      } else {
        const result = JSON.parse(await GitSync.CherryPick(repoPath, [payload.hash], false, '', true)) as { success: boolean; error?: string }
        if (!result.success) throw new Error(result.error || 'Cherry-pick stopped; resolve conflicts from the Changes panel.')
      }
    }, payload.type === 'commit' ? `Cherry-picked ${payload.hash.slice(0, 7)} onto ${branch}.` : `${operation === 'merge' ? 'Merged' : 'Rebased'} ${payload.name} ${operation === 'merge' ? 'into' : 'onto'} ${branch}.`)
  }

  const currentBranch = status.branch || 'master'
  const hasRemote = (overview?.remotes.length ?? 0) > 0

  // Left click selects (and shows details); Ctrl/Cmd toggles, Shift extends a
  // range — multi-selection drives the bulk commit actions.
  const handleCommitClick = (commit: CommitInfo, event: React.MouseEvent) => {
    const full = commit.fullHash || commit.hash
    if (event.metaKey || event.ctrlKey) {
      setSelectedHashes((prev) => (prev.includes(full) ? prev.filter((h) => h !== full) : [...prev, full]))
      setSelectedHash(commit.hash)
      return
    }
    if (event.shiftKey) {
      const anchor = filteredCommits.findIndex((c) => c.hash === selectedHash)
      const clicked = filteredCommits.findIndex((c) => (c.fullHash || c.hash) === full)
      if (anchor >= 0 && clicked >= 0) {
        const [lo, hi] = [Math.min(anchor, clicked), Math.max(anchor, clicked)]
        setSelectedHashes(filteredCommits.slice(lo, hi + 1).map((c) => c.fullHash || c.hash))
        return
      }
    }
    setSelectedHash(commit.hash)
    setSelectedHashes([full])
  }

  const handleCommitContextMenu = (commit: CommitInfo, event: React.MouseEvent) => {
    event.preventDefault()
    const full = commit.fullHash || commit.hash
    if (!selectedHashes.includes(full)) {
      setSelectedHash(commit.hash)
      setSelectedHashes([full])
    }
    setFileMenu(null)
    setCommitMenu({ commit, x: event.clientX, y: event.clientY })
  }

  const closeMenus = () => { setCommitMenu(null); setFileMenu(null) }

  if (gitAvailable === false) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <AlertTriangle size={32} className="text-warning" />
          <p className="text-sm font-medium text-text-1">Git Sync unavailable</p>
          <p className="text-xs text-text-3">Run adOmnia as the desktop app with Git on your PATH to use repository commands.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-0">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-3">
        <div className="mr-3 flex items-center gap-2">
          <GitBranch size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-1">Git Sync</span>
        </div>
        <button onClick={() => runAction(() => GitSync.Fetch(repoPath), 'Fetch complete.')} disabled={!repoPath || loading} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} /> Fetch
        </button>
        <button onClick={() => runAction(() => GitSync.Pull(repoPath, currentBranch), 'Pull complete.')} disabled={!repoPath || loading} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <Download size={13} /> Pull
        </button>
        <button onClick={() => runAction(() => GitSync.Push(repoPath, currentBranch), 'Push complete.')} disabled={!repoPath || loading} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <Upload size={13} /> Push
        </button>
        <button onClick={() => runAction(() => GitSync.Stash(repoPath), 'Working changes stashed.')} disabled={!repoPath || loading || !status.dirty} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:text-text-4 disabled:opacity-40">
          <Archive size={13} /> Stash
        </button>
        <div className="mx-2 h-6 w-px bg-border-2" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            onClick={browseFolder}
            title="Browse for a repository folder"
            className="flex h-8 shrink-0 items-center rounded border border-border-1 px-2 text-text-3 hover:bg-surface-2 hover:text-text-1"
          >
            <FolderOpen size={13} />
          </button>
          <input
            className="h-8 min-w-0 flex-1 rounded border border-border-1 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent"
            placeholder="Repository path..."
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && refreshStatus()}
          />
          <button onClick={handleInit} disabled={!repoPath || loading} className="h-8 rounded border border-border-1 px-3 text-xs text-text-2 hover:bg-surface-2 disabled:opacity-40">Init</button>
          <button onClick={() => refreshStatus()} disabled={!repoPath || loading} className="h-8 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40">Load</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border-1 bg-surface-1 flex-shrink-0">
        <button
          onClick={() => setActiveTab('sync')}
          className={cn(
            'px-4 py-2 text-[11px] font-medium transition-colors',
            activeTab === 'sync' ? 'text-accent border-b-2 border-accent' : 'text-text-4 hover:text-text-2',
          )}
        >
          Sync
        </button>
        <button
          onClick={() => setActiveTab('compare')}
          className={cn(
            'px-4 py-2 text-[11px] font-medium transition-colors',
            activeTab === 'compare' ? 'text-accent border-b-2 border-accent' : 'text-text-4 hover:text-text-2',
          )}
        >
          Compare
        </button>
        <button
          onClick={() => setActiveTab('actions')}
          className={cn(
            'px-4 py-2 text-[11px] font-medium transition-colors',
            activeTab === 'actions' ? 'text-accent border-b-2 border-accent' : 'text-text-4 hover:text-text-2',
          )}
        >
          Actions
        </button>
      </div>

      {activeTab === 'compare' ? (
        <GitCompareTab repoPath={repoPath} />
      ) : activeTab === 'actions' ? (
        <GitActionsTab
          repoPath={repoPath}
          currentBranch={currentBranch}
          changes={overview?.changes ?? []}
          branches={overview?.branches ?? []}
          remotes={overview?.remotes ?? []}
          stashes={overview?.stashes ?? []}
          loading={loading}
          setRepoPath={setRepoPath}
          runAction={runAction}
        />
      ) : (
        <>
      {(error || info) && (
        <div className={cn('flex items-center gap-2 border-b px-3 py-2 text-xs', error ? 'border-error/30 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success')}>
          {error ? <XCircle size={13} /> : <CheckCircle size={13} />}
          <span className="truncate">{error || info}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside style={{ width: columnWidths.sidebar }} className="min-h-0 shrink-0 overflow-y-auto border-r border-border-1 bg-surface-1">
          <div className="border-b border-border-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Workspaces</div>
              <div className="flex items-center gap-1">
              <button onClick={() => void refreshAllRepoSummaries()} disabled={loadingRepoSummaries || repos.length === 0} title="Refresh all repository statuses" className="flex h-5 w-5 items-center justify-center rounded text-text-4 hover:bg-surface-2 hover:text-accent disabled:opacity-40"><RefreshCw size={11} className={loadingRepoSummaries ? 'animate-spin' : ''} /></button>
              <button
                onClick={browseFolder}
                title="Add a repository"
                className="flex h-5 w-5 items-center justify-center rounded text-text-4 hover:bg-surface-2 hover:text-accent"
              >
                <Plus size={13} />
              </button>
              </div>
            </div>
            {repos.length === 0 ? (
              <div className="rounded border border-dashed border-border-2 px-2 py-2 text-[11px] text-text-4">
                Load a repository to save it here.
              </div>
            ) : (
              <div className="space-y-0.5">
                {sortedRepos.map((repo) => (
                  <div
                    key={repo.path}
                    onClick={() => selectRepo(repo.path)}
                    title={repo.path}
                    className={cn(
                      'group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                      repo.path === repoPath ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
                    )}
                  >
                    <GitBranch size={12} className={cn('shrink-0', repo.path === repoPath ? 'text-accent' : 'text-text-4')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{repo.name}</div>
                      <div className="truncate text-[10px] text-text-4">{repo.path}</div>
                      {repoSummaries[repo.path] && <div className="mt-0.5 flex gap-1 text-[9px]"><span className="truncate text-text-3">{repoSummaries[repo.path].branch}</span><span className={repoSummaries[repo.path].dirty ? 'text-warning' : 'text-success'}>{repoSummaries[repo.path].dirty ? 'dirty' : 'clean'}</span>{(repoSummaries[repo.path].aheadCount > 0 || repoSummaries[repo.path].behindCount > 0) && <span className="text-text-4">↑{repoSummaries[repo.path].aheadCount} ↓{repoSummaries[repo.path].behindCount}</span>}</div>}
                    </div>
                    <button
                      onClick={(event) => { event.stopPropagation(); setRepos((current) => toggleRepoPin(current, repo.path)) }}
                      title={repo.pinned ? 'Unpin repository' : 'Pin repository'}
                      className={cn('shrink-0 rounded p-0.5 transition-opacity hover:text-accent', repo.pinned ? 'text-accent opacity-100' : 'text-text-4 opacity-0 group-hover:opacity-100')}
                    >
                      <Pin size={11} fill={repo.pinned ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={(event) => handleRemoveRepo(event, repo.path)}
                      title="Remove from list"
                      className="shrink-0 rounded p-0.5 text-text-4 opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="border-b border-border-1 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Repository</div>
            <div className="truncate text-xs font-semibold text-text-1">{repoPath ? repoPath.split(/[\\/]/).pop() : 'No repository loaded'}</div>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
              <span className="rounded border border-border-2 px-1.5 py-0.5 text-text-3">{status.branch || 'no branch'}</span>
              <span className={cn('rounded border px-1.5 py-0.5', status.dirty ? 'border-warning/50 text-warning' : 'border-success/50 text-success')}>
                {status.dirty ? `${overview?.changes.length ?? 0} changes` : 'clean'}
              </span>
              {(status.aheadCount > 0 || status.behindCount > 0) && <span className="rounded border border-border-2 px-1.5 py-0.5 text-text-3">{status.aheadCount} ahead / {status.behindCount} behind</span>}
            </div>
          </div>

          <div className="border-b border-border-1 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Collection Folder</div>
              {targetCollectionFolder && (
                <span className="truncate text-[10px] text-text-4" title={targetCollectionFolder}>
                  {targetCollectionFolder.split(/[\\/]/).slice(-2).join('/')}
                </span>
              )}
            </div>
            <select
              value={selectedCollection?.id ?? ''}
              onChange={(event) => setSelectedCollectionId(event.target.value)}
              disabled={!collections.length || loading}
              className="mb-2 h-7 w-full rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50"
            >
              {collections.length === 0 ? (
                <option value="">No collections</option>
              ) : collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={exportSelectedCollection}
                disabled={!repoPath || !selectedCollection || !hasCollectionFSBinding() || loading}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-border-1 text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40"
                title={targetCollectionFolder || 'Export selected collection'}
              >
                <Upload size={12} /> Export
              </button>
              <button
                onClick={exportActiveRequest}
                disabled={!repoPath || !selectedCollection || !activeCollectionRequest || !hasCollectionFSBinding() || loading}
                className="flex h-7 items-center justify-center gap-1 rounded border border-border-1 text-[10px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40"
                title={activeCollectionRequest ? `Export only ${activeCollectionRequest.name}` : 'Open a request from this collection'}
              >
                <Upload size={11} /> Request
              </button>
              <button
                onClick={importCollectionFolder}
                disabled={!hasCollectionFSBinding() || loading}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-border-1 text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40"
                title="Import collection folder"
              >
                <Download size={12} /> Import
              </button>
              <button
                onClick={inspectSelectedCollectionFolder}
                disabled={!repoPath || !selectedCollection || !hasCollectionFSBinding() || loading}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-border-1 text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40"
                title={targetCollectionFolder || 'Inspect collection folder'}
              >
                <Eye size={12} /> Drift
              </button>
            </div>
          </div>

          <div className="border-b border-border-1 p-3">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-2 text-text-4" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-7 w-full rounded border border-border-1 bg-surface-0 pl-7 pr-2 text-xs text-text-1 outline-none focus:border-accent" placeholder="Filter commits..." />
            </div>
          </div>

          <nav className="space-y-4 p-3 text-xs">
            <section>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4"><GitFork size={11} /> Branches</div>
              {localBranches.length === 0 && <div className="px-2 py-1 text-text-4">No local branches loaded</div>}
              {sortedLocalBranches.map((branch) => (
                <div key={branch.name} onDragOver={(event) => { if (dragPayload) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (dragPayload && !(dragPayload.type === 'branch' && dragPayload.name === branch.name)) setDropTarget({ payload: dragPayload, branch: branch.name }) }} className="group flex items-center gap-1">
                  <button onClick={() => setPinnedBranches(toggleBranchPin(repoPath, branch.name))} title={pinnedBranches.includes(branch.name) ? 'Unpin branch' : 'Pin branch'} className={cn('shrink-0 rounded p-0.5 hover:text-accent', pinnedBranches.includes(branch.name) ? 'text-accent' : 'text-text-4 opacity-0 group-hover:opacity-100')}>
                    <Pin size={10} fill={pinnedBranches.includes(branch.name) ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    draggable
                    onDragStart={() => setDragPayload({ type: 'branch', name: branch.name })}
                    onDragEnd={() => setDragPayload(null)}
                    onClick={() => { if (!branch.current) checkoutLocal(branch.name) }}
                    disabled={loading}
                    title={branch.current ? 'Current branch' : `Switch to ${shortBranch(branch.name)}`}
                    className={cn('flex flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2 disabled:hover:bg-transparent', branch.current ? 'text-accent' : 'text-text-2')}
                  >
                    <span className="truncate">{shortBranch(branch.name)}</span>
                    {branch.current && <Check size={11} />}
                  </button>
                  {!branch.current && (
                    <button onClick={() => deleteLocal(branch.name)} title="Delete branch" className="shrink-0 rounded p-0.5 text-text-4 opacity-0 transition-opacity hover:text-error group-hover:opacity-100">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </section>
            <section>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4"><GitPullRequest size={11} /> Remotes</div>
              {overview?.remotes.map((item) => (
                <div key={item.name} className="rounded px-2 py-1.5 text-text-2">
                  <div className="font-medium">{item.name}</div>
                  <div className="truncate text-[10px] text-text-4">{item.url}</div>
                </div>
              ))}
              {sortedRemoteBranches.slice(0, 8).map((branch) => (
                <div key={branch.name} className="group flex items-center gap-1">
                  <button onClick={() => setPinnedBranches(toggleBranchPin(repoPath, branch.name))} title={pinnedBranches.includes(branch.name) ? 'Unpin branch' : 'Pin branch'} className={cn('shrink-0 rounded p-0.5 hover:text-accent', pinnedBranches.includes(branch.name) ? 'text-accent' : 'text-text-4 opacity-0 group-hover:opacity-100')}>
                    <Pin size={10} fill={pinnedBranches.includes(branch.name) ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => checkoutRemote(branch.name)}
                    disabled={loading}
                    title={`Checkout ${shortBranch(branch.name)} as a tracking branch`}
                    className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-text-3 hover:bg-surface-2 hover:text-text-1"
                  >
                    {shortBranch(branch.name)}
                  </button>
                  <button onClick={() => deleteRemote(branch.name)} title="Delete branch on remote" className="shrink-0 rounded p-0.5 text-text-4 opacity-0 transition-opacity hover:text-error group-hover:opacity-100">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </section>
            <section>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4"><Archive size={11} /> Stashes</div>
              {(overview?.stashes.length ?? 0) === 0 && <div className="px-2 py-1 text-text-4">No stashes</div>}
              {overview?.stashes.map((stash) => <div key={stash} className="truncate rounded px-2 py-1 text-text-3">{stash}</div>)}
            </section>
          </nav>
        </aside>

        <ResizeHandle label="Resize Git sidebar" onMouseDown={startColumnResize('sidebar', 1)} withLine={false} />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <HistorySearchBar repoPath={repoPath} onResults={setSearchResults} setError={setError} />
          <div className="grid h-10 shrink-0 items-center border-b border-border-1 bg-surface-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-4" style={graphGridStyle}>
            <span>Graph</span><span>Commit</span>
            <span className="flex items-center justify-end gap-2">
              {selectedHashes.length > 1 && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] text-accent">{selectedHashes.length} selected</span>}
              <span>{filteredCommits.length} loaded</span>
              Date
            </span>
          </div>
          <div ref={graphScrollRef} onScroll={handleGraphScroll} className="min-h-0 flex-1 overflow-y-auto">
            <div aria-hidden style={{ height: graphWindow.start * graphWindow.rowHeight }} />
            {graphWindow.commits.map((commit, windowIndex) => {
              const index = graphWindow.start + windowIndex
              return (
              <button
                key={commit.fullHash || commit.hash}
                draggable
                onDragStart={() => setDragPayload({ type: 'commit', hash: commit.fullHash || commit.hash })}
                onDragEnd={() => setDragPayload(null)}
                onClick={(event) => handleCommitClick(commit, event)}
                onContextMenu={(event) => handleCommitContextMenu(commit, event)}
                className={cn(
                  'grid h-[58px] w-full items-center overflow-hidden border-b border-border-1 px-3 text-left transition-colors hover:bg-surface-2',
                  selectedHashes.includes(commit.fullHash || commit.hash) && 'bg-accent/5',
                  selectedCommit?.hash === commit.hash && 'bg-surface-2 shadow-[inset_3px_0_0_var(--color-accent)]',
                )}
                style={graphGridStyle}
              >
                <GitCommitGraph layout={graphLayout.rows[index]} width={graphColumnWidth} />
                <div className="min-w-0 py-2.5">
                  <div className="truncate text-[12px] font-semibold leading-5 text-text-1" title={commit.message}>{commit.message}</div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 max-w-[180px] truncate text-[10px] text-text-3">{commit.author}</span>
                    <code className="rounded bg-surface-0 px-1.5 py-0.5 text-[10px] text-accent">{commit.hash}</code>
                    {commit.decorations.slice(0, 3).map((decoration) => (
                      <span key={decoration} className="max-w-[150px] truncate rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{decoration}</span>
                    ))}
                    {commit.decorations.length > 3 && <span className="rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-4">+{commit.decorations.length - 3}</span>}
                    {commit.parents.length > 1 && <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">merge</span>}
                  </div>
                </div>
                <span className="text-right text-[11px] text-text-3">{commit.date}</span>
              </button>
              )
            })}
            <div aria-hidden style={{ height: Math.max(0, filteredCommits.length - graphWindow.end) * graphWindow.rowHeight }} />
            {repoPath && filteredCommits.length === 0 && <div className="p-8 text-center text-xs text-text-4">No commits found.</div>}
            {!repoPath && <div className="p-8 text-center text-xs text-text-4">Load a repository to inspect the graph.</div>}
          </div>

          <section className="h-60 shrink-0 overflow-hidden border-t border-border-1 bg-surface-1">
            {selectedCommit ? (
              <div className="grid h-full grid-cols-[minmax(240px,.75fr)_minmax(340px,1.25fr)]">
                <div className="min-w-0 overflow-y-auto border-r border-border-1 p-3">
                  <div className="mb-3 flex items-start gap-2 text-sm font-semibold text-text-1">
                    {selectedCommit.parents.length > 1 ? <GitMerge size={15} className="mt-0.5 shrink-0 text-warning" /> : <GitCommit size={15} className="mt-0.5 shrink-0 text-accent" />}
                    <span className="min-w-0 break-words" title={selectedCommit.message}>{selectedCommit.message}</span>
                  </div>
                  <div className="grid gap-2 text-xs">
                    <div className="rounded border border-border-1 bg-surface-0 p-2.5">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-4">Author</div>
                      <div className="text-text-1">{selectedCommit.author}</div>
                      <div className="mt-1 text-text-4">{selectedCommit.date}</div>
                    </div>
                    <div className="rounded border border-border-1 bg-surface-0 p-2.5">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-4">Refs</div>
                      <div className="truncate font-mono text-text-2" title={selectedCommit.fullHash}>sha {selectedCommit.fullHash}</div>
                      <div className="mt-1 truncate font-mono text-text-4" title={selectedCommit.parents[0] || 'empty tree'}>base {selectedCommit.parents[0] || 'empty tree'}</div>
                      {selectedCommit.parents.length > 1 && <div className="mt-1 text-warning">Merge commit: showing files against first parent.</div>}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col">
                  <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-1 px-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Files changed by this commit</div>
                    <span className="text-[10px] text-text-4">{commitFilesLoading ? 'loading...' : `${commitFiles.length} files`}</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {commitFilesLoading && <div className="rounded border border-border-1 bg-surface-0 p-4 text-center text-xs text-text-4">Loading commit files...</div>}
                    {!commitFilesLoading && commitFiles.length === 0 && <div className="rounded border border-border-1 bg-surface-0 p-4 text-center text-xs text-text-4">No file changes found for this commit.</div>}
                    <div className="space-y-1">
                      {commitFiles.map((file) => (
                        <button
                          key={`${file.status}-${file.path}-${file.oldPath ?? ''}`}
                          onClick={() => void openCommitDiff(file)}
                          onContextMenu={(event) => {
                            if (!selectedCommit) return
                            event.preventDefault()
                            setCommitMenu(null)
                            setFileMenu({ file, commit: selectedCommit as unknown as GitCommitInfo, x: event.clientX, y: event.clientY })
                          }}
                          className="flex w-full items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5 text-left hover:bg-surface-2"
                        >
                          <span className={cn('w-16 rounded px-1.5 py-0.5 text-center text-[9px]', changedFileClass(file.status))}>{changedFileLabel(file.status)}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2" title={file.path}>{file.path}</span>
                          {file.oldPath && <span className="max-w-[150px] truncate text-[10px] text-text-4">from {file.oldPath}</span>}
                          <Eye size={12} className="shrink-0 text-text-4" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-text-4">Select a commit to inspect details.</div>
            )}
          </section>
        </main>

        <ResizeHandle label="Resize Git commit panel" onMouseDown={startColumnResize('commitPanel', -1)} withLine={false} />

        <aside style={{ width: columnWidths.commitPanel }} className="min-h-0 shrink-0 overflow-y-auto border-l border-border-1 bg-surface-1">
          <div className="border-b border-border-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Commit</div>
              <span className="text-[10px] text-text-4">{stagedFiles.length} staged</span>
            </div>
            <div className="flex gap-2">
              <input
                className="h-8 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent"
                placeholder="Commit message..."
                value={commitMsg}
                onChange={(event) => setCommitMsg(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleCommit()}
              />
              <button onClick={handleCommit} disabled={!repoPath || !commitMsg.trim() || loading || stagedFiles.length === 0} className="h-8 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40">Commit</button>
              <button
                onClick={() => void runChangesAi('ai.betterMessage', 'staged', '', true)}
                disabled={!repoPath || loading || !!aiBusy || stagedFiles.length === 0}
                title="Generate commit message from staged changes"
                className="flex h-8 items-center gap-1.5 rounded border border-accent/50 px-2.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                <Sparkles size={13} className={aiBusy === 'staged:ai.betterMessage' ? 'animate-pulse' : ''} /> Generate
              </button>
            </div>
            {changes.length > 0 && stagedFiles.length === 0 && (
              <div className="mt-1.5 text-[10px] text-text-4">Stage at least one file (or hunk) to commit.</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border-1 pt-2">
              <button disabled={!repoPath || changes.length === 0 || !!aiBusy} onClick={() => void runChangesAi('ai.explain', 'working')} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40">Explain working changes</button>
              <button disabled={!repoPath || changes.length === 0 || !!aiBusy} onClick={() => void runChangesAi('ai.risky', 'working')} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40">Risk scan</button>
              <select value={selectedAiBase} onChange={(event) => setAiBaseBranch(event.target.value)} disabled={aiBaseChoices.length === 0} className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-1.5 text-[10px] text-text-2">
                {aiBaseChoices.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
              </select>
              <button disabled={!selectedAiBase || !!aiBusy} onClick={() => void runChangesAi('ai.summarize', 'branch', selectedAiBase)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40">Analyze branch</button>
            </div>
          </div>

          {(overview?.conflicts.length ?? 0) > 0 && (
            <section className="border-b border-border-1 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-warning"><FileWarning size={13} /> Merge conflicts</div>
              <div className="space-y-2">
                {overview?.conflicts.map((change) => (
                  <div key={change.path} className="rounded border border-warning/40 bg-warning/10 p-2">
                    <div className="truncate text-xs font-medium text-text-1">{change.path}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      <button onClick={() => runAction(() => GitSync.CheckoutConflictSide(repoPath, change.path, 'ours'), `Kept ours for ${change.path}.`)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1">Ours</button>
                      <button onClick={() => runAction(() => GitSync.CheckoutConflictSide(repoPath, change.path, 'theirs'), `Kept theirs for ${change.path}.`)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1">Theirs</button>
                      <button onClick={() => runAction(() => GitSync.StageFile(repoPath, change.path), `Staged ${change.path}.`)} className="rounded border border-accent/50 px-2 py-1 text-[10px] text-accent">Stage</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => runAction(() => GitSync.AbortIntegration(repoPath), 'Merge/rebase aborted.')} className="mt-2 w-full rounded border border-error/40 px-2 py-1.5 text-xs text-error hover:bg-error/10">Abort merge/rebase</button>
            </section>
          )}

          <section
            className="p-3"
            onDragOver={(event) => { if (dragFile?.mode === 'stage') event.preventDefault() }}
            onDrop={(event) => { event.preventDefault(); if (dragFile?.mode === 'stage') stageFile(dragFile.path) }}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Staged ({stagedFiles.length})</div>
              {stagedFiles.length > 0 && (
                <button onClick={unstageAll} className="rounded px-1 text-[10px] text-text-4 hover:text-text-1">Unstage all</button>
              )}
            </div>
            <div className="space-y-1">
              {stagedFiles.map((change) => renderChangeRow(change, 'unstage'))}
              {stagedFiles.length === 0 && <div className="rounded border border-dashed border-border-2 p-2.5 text-center text-[10px] text-text-4">Nothing staged.</div>}
            </div>

            <div
              className="mb-2 mt-4 flex items-center justify-between"
              onDragOver={(event) => { if (dragFile?.mode === 'unstage') event.preventDefault() }}
              onDrop={(event) => { event.preventDefault(); if (dragFile?.mode === 'unstage') unstageFile(dragFile.path) }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Unstaged ({unstagedFiles.length})</div>
              {unstagedFiles.length > 0 && (
                <button onClick={stageAll} className="rounded px-1 text-[10px] text-text-4 hover:text-text-1">Stage all</button>
              )}
            </div>
            <div
              className="space-y-1"
              onDragOver={(event) => { if (dragFile?.mode === 'unstage') event.preventDefault() }}
              onDrop={(event) => { event.preventDefault(); if (dragFile?.mode === 'unstage') unstageFile(dragFile.path) }}
            >
              {unstagedFiles.map((change) => renderChangeRow(change, 'stage'))}
              {unstagedFiles.length === 0 && <div className="rounded border border-dashed border-border-2 p-2.5 text-center text-[10px] text-text-4">{changes.length === 0 ? 'Working tree clean.' : 'Nothing to stage.'}</div>}
            </div>
          </section>
        </aside>
      </div>
        </>
      )}
      <GitGraphActions
        repoPath={repoPath}
        commits={filteredCommits as unknown as GitCommitInfo[]}
        selectedHashes={selectedHashes}
        currentBranch={currentBranch}
        hasRemote={hasRemote}
        commitMenu={commitMenu}
        fileMenu={fileMenu}
        onCloseMenus={closeMenus}
        onRefresh={() => void refreshStatus()}
        setInfo={setInfo}
        setError={setError}
      />

      {commitDiffFile && (
        <DiffModal
          title={`Commit diff - ${commitDiffFile.path}`}
          leftLabel={`${selectedCommitBaseRef} - ${commitDiffFile.path}`}
          rightLabel={`${selectedCommit?.hash ?? 'commit'} - ${commitDiffFile.path}`}
          leftBody={extractOldContent(commitDiffText)}
          rightBody={extractNewContent(commitDiffText)}
          leftDownloadName={downloadSafeName(commitDiffFile.path, 'before.txt')}
          rightDownloadName={downloadSafeName(commitDiffFile.path, 'after.txt')}
          onClose={() => {
            setCommitDiffFile(null)
            setCommitDiffText('')
          }}
        />
      )}
      {hunkTarget && (
        <HunkStageDialog
          repoPath={repoPath}
          path={hunkTarget.path}
          mode={hunkTarget.mode}
          onDone={() => void refreshStatus()}
          onClose={() => setHunkTarget(null)}
        />
      )}
      {aiResult && <TextResultDialog title={aiResult.title} text={aiResult.text} loading={false} onClose={() => setAiResult(null)} />}
      {dropTarget && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/65 p-6" onClick={() => setDropTarget(null)}>
          <div className="w-[430px] rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-border-1 px-4 py-3 text-sm font-semibold text-text-1">Git drag & drop</div>
            <div className="space-y-2 p-4 text-xs text-text-2">
              {dropTarget.payload.type === 'branch' ? <p>Apply branch <code className="text-accent">{dropTarget.payload.name}</code> to <code className="text-accent">{dropTarget.branch}</code>.</p> : <p>Cherry-pick commit <code className="text-accent">{dropTarget.payload.hash.slice(0, 7)}</code> onto <code className="text-accent">{dropTarget.branch}</code>.</p>}
              {status.branch !== dropTarget.branch && <p className="text-warning">adOmnia will first switch from {status.branch} to {dropTarget.branch}.</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-1 px-4 py-3">
              <button onClick={() => setDropTarget(null)} className="h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-3">Cancel</button>
              {dropTarget.payload.type === 'branch' ? <><button onClick={() => executeDrop('rebase')} className="h-7 rounded border border-border-2 px-3 text-xs text-text-2 hover:bg-surface-2">Rebase target</button><button onClick={() => executeDrop('merge')} className="h-7 rounded bg-accent px-3 text-xs font-medium text-white">Merge into target</button></> : <button onClick={() => executeDrop('cherry-pick')} className="h-7 rounded bg-accent px-3 text-xs font-medium text-white">Cherry-pick</button>}
            </div>
          </div>
        </div>
      )}
      {workingDiffFile && workingDiffSnapshot && (
        <DiffModal
          title={`Working tree diff - ${workingDiffSnapshot.path}`}
          leftLabel={`HEAD - ${workingDiffSnapshot.oldPath || workingDiffSnapshot.path}`}
          rightLabel={`Working tree - ${workingDiffSnapshot.path}`}
          leftBody={workingDiffSnapshot.oldContent}
          rightBody={workingDiffSnapshot.newContent}
          leftDownloadName={downloadSafeName(workingDiffSnapshot.oldPath || workingDiffSnapshot.path, 'head.txt')}
          rightDownloadName={downloadSafeName(workingDiffSnapshot.path, 'working.txt')}
          defaultDiffOnly={false}
          onClose={() => {
            setWorkingDiffFile(null)
            setWorkingDiffSnapshot(null)
          }}
        />
      )}
    </div>
  )
}
