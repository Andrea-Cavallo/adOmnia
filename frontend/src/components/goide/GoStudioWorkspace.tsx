import { Braces, ChevronDown, ChevronRight, FileCode2, Folder, Info, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { GoIDECapabilities, GoIDESession } from '@/lib/goide-api'
import { ResizeHandle } from '@/components/ui/ResizeHandle'

interface GoStudioWorkspaceProps {
  session: GoIDESession
  capabilities: GoIDECapabilities | null
  projectWidth: number
  structureWidth: number
  bottomHeight: number
  structureOpen: boolean
  bottomOpen: boolean
  onProjectResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onStructureResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onBottomResize: (event: React.MouseEvent<HTMLDivElement>) => void
}

function ProjectPane({ session }: { session: GoIDESession }) {
  const project = session.project
  return (
    <aside aria-label="Project files" className="h-full min-w-0 bg-surface-1">
      <div className="flex h-8 items-center gap-1.5 border-b border-border-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-3">
        <ChevronDown size={11} /> Project
      </div>
      <div className="p-2 text-[11px] text-text-2">
        <div className="flex items-center gap-1.5 py-1 font-medium text-text-1"><Folder size={13} className="text-accent" /> {project.name}</div>
        {project.goWorkPath && <div className="ml-4 flex items-center gap-1.5 py-1"><FileCode2 size={12} /> go.work</div>}
        {project.goModPath && <div className="ml-4 flex items-center gap-1.5 py-1"><FileCode2 size={12} /> go.mod</div>}
        {!project.goModPath && !project.goWorkPath && <p className="ml-4 py-2 text-text-4">No go.mod or go.work at project root.</p>}
      </div>
    </aside>
  )
}

function EditorOverview({ session }: { session: GoIDESession }) {
  const project = session.project
  return (
    <section aria-label="Editor" className="flex min-h-0 flex-1 flex-col bg-surface-0">
      <div className="flex h-8 items-center border-b border-border-1 bg-surface-1 px-3 text-[11px] text-text-3">Project overview</div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl border border-border-1 bg-surface-1 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-1"><Braces size={17} className="text-accent" /> {project.name}</div>
          <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 text-[11px]">
            <dt className="text-text-4">Root</dt><dd className="truncate font-mono text-text-2" title={project.rootPath}>{project.rootPath}</dd>
            <dt className="text-text-4">Go workspace</dt><dd className="text-text-2">{project.goWorkPath ? 'go.work detected' : 'Not detected at root'}</dd>
            <dt className="text-text-4">Modules</dt><dd className="text-text-2">{project.modules.length || 'None detected at root'}</dd>
            <dt className="text-text-4">Tool access</dt><dd className="flex items-center gap-1.5 text-text-2">{project.authorization === 'tooling-permitted' ? <ShieldCheck size={12} className="text-success" /> : <LockKeyhole size={12} />} {project.authorization === 'tooling-permitted' ? 'Permitted; tools still require an explicit action' : 'Restricted'}</dd>
          </dl>
          <p className="mt-5 border-t border-border-1 pt-4 text-[10px] leading-4 text-text-4">The project is registered in place. No source, script, test, or Go command has been executed.</p>
        </div>
      </div>
    </section>
  )
}

function StructurePane() {
  return (
    <aside aria-label="File structure" className="h-full bg-surface-1">
      <div className="flex h-8 items-center gap-1.5 border-b border-border-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-3"><ChevronRight size={11} /> Structure</div>
      <div className="flex items-start gap-2 p-3 text-[10px] leading-4 text-text-4"><Info size={12} className="mt-0.5 shrink-0" /> Open a source document to inspect its symbols.</div>
    </aside>
  )
}

export function GoStudioWorkspace({ session, capabilities, projectWidth, structureWidth, bottomHeight, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize }: GoStudioWorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div style={{ width: projectWidth }} className="shrink-0"><ProjectPane session={session} /></div>
        <ResizeHandle label="Resize project pane" onMouseDown={onProjectResize} />
        <EditorOverview session={session} />
        {structureOpen && <>
          <ResizeHandle label="Resize structure pane" onMouseDown={onStructureResize} />
          <div style={{ width: structureWidth }} className="shrink-0"><StructurePane /></div>
        </>}
      </div>
      {bottomOpen && (
        <>
        <ResizeHandle label="Resize activity pane" orientation="horizontal" onMouseDown={onBottomResize} />
        <section aria-label="Go Studio activity" style={{ height: bottomHeight }} className="shrink-0 border-t border-border-1 bg-surface-1">
          <div className="flex h-8 items-center gap-3 border-b border-border-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-3">
            Activity <span className="font-normal normal-case tracking-normal text-text-4">Session {session.id.slice(-8)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 p-3 text-[10px] text-text-3">
            <div>Project opening <span className="ml-1 text-success">available</span></div>
            <div>Multiple sessions <span className="ml-1 text-success">{capabilities?.multipleSessions ? 'available' : 'unavailable'}</span></div>
            <div>Editor and filesystem <span className="ml-1 text-text-4">not enabled yet</span></div>
            <div>Go toolchain execution <span className="ml-1 text-text-4">not enabled yet</span></div>
          </div>
        </section>
        </>
      )}
    </div>
  )
}
