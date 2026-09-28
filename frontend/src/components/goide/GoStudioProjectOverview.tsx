import { AlertTriangle, Boxes, FileCode2, FolderTree, Layers } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'

interface GoStudioProjectOverviewProps {
  session: GoIDESession
}

function relativeTo(root: string, path: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedPath = path.replace(/\\/g, '/')
  if (normalizedPath.toLowerCase() === normalizedRoot.toLowerCase()) return '.'
  const prefix = `${normalizedRoot}/`
  return normalizedPath.toLowerCase().startsWith(prefix.toLowerCase()) ? normalizedPath.slice(prefix.length) : normalizedPath
}

function SectionTitle({ icon, label, count }: { icon: React.ReactNode; label: string; count?: number }) {
  return (
    <h3 className="mb-1 mt-3 flex items-center gap-1.5 px-2 text-[9px] font-semibold uppercase tracking-wider text-text-4 first:mt-2">
      {icon}{label}{count !== undefined && <span className="ml-auto font-mono text-text-4">{count}</span>}
    </h3>
  )
}

export function GoStudioProjectOverview({ session }: GoStudioProjectOverviewProps) {
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const { project } = session
  const modules = project.modules ?? []
  const looseDirectories = project.looseGoDirs ?? []
  const roots = [project.realPath, project.rootPath]
  const relative = (path: string) => relativeTo(roots.find((root) => relativeTo(root, path) !== path) ?? project.rootPath, path)

  return (
      <div aria-label="Project overview" className="min-h-0 flex-1 overflow-auto pb-2 text-[10px]">
        <SectionTitle icon={<Layers size={10} />} label="Go workspace" />
        {project.goWorkPath ? (
          <button type="button" onClick={() => void openDocument('go.work')} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-text-2 hover:bg-surface-3 hover:text-text-1"><FileCode2 size={11} className="text-accent" /> go.work</button>
        ) : <p className="px-2 py-1 text-text-4">{modules.length > 1 ? 'No go.work: modules build independently.' : 'No go.work file.'}</p>}

        <SectionTitle icon={<Boxes size={10} />} label="Modules" count={modules.length} />
        {modules.length === 0 && <p className="px-2 py-1 leading-4 text-text-4">Folder mode: no go.mod found. Create a module with <code className="font-mono text-text-3">go mod init</code> to build packages.</p>}
        {modules.map((module) => {
          const directory = relative(module.path)
          const goModPath = directory === '.' ? 'go.mod' : `${directory}/go.mod`
          return (
            <button key={module.path} type="button" onClick={() => void openDocument(goModPath)} title={`Open ${goModPath}`} className="block w-full px-2 py-1 text-left hover:bg-surface-3">
              <span className="block truncate font-mono text-[10px] text-text-1">{module.modulePath || '(module path missing)'}</span>
              <span className="block truncate text-[9px] text-text-4">{directory === '.' ? 'project root' : directory}</span>
            </button>
          )
        })}

        {looseDirectories.length > 0 && <>
          <SectionTitle icon={<AlertTriangle size={10} className="text-warning" />} label="Go files outside modules" count={looseDirectories.length} />
          {looseDirectories.map((directory) => <p key={directory} className="truncate px-2 py-0.5 font-mono text-[10px] text-warning/90" title="These .go files are not covered by any go.mod">{directory === '.' ? '(project root)' : directory}</p>)}
        </>}

        <SectionTitle icon={<FolderTree size={10} />} label="Root" />
        <p className="break-all px-2 font-mono text-[9px] leading-4 text-text-3">{project.rootPath}</p>

      </div>
  )
}
