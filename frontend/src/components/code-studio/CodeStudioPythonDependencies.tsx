import { useEffect, useState } from 'react'
import { AlertCircle, FileCode2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import { listPythonDependencies, type GoIDEPythonUnitDependencies } from '@/lib/code-studio-api'
import type { PythonBuildUnit } from '@/lib/code-studio/pythonUnits'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { usePythonSecurityStore } from '@/stores/codeStudioPythonSecurity'
import { pythonRequirementStatuses, parsePythonManifest, type PythonRequirementStatus } from '@/lib/code-studio/pythonManifestSecurity'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField } from './CodeStudioModal'

interface Props {
  session: GoIDESession
  units: PythonBuildUnit[]
  onClose: () => void
}

const normalize = (path: string) => path.replace(/\\/g, '/')

function unitRoot(project: GoIDESession['project'], unit: string): string {
  const root = normalize(project.realPath ?? project.rootPath ?? '').replace(/\/$/, '')
  return unit === '.' || unit === '' ? root : `${root}/${unit}`
}

/**
 * Dipendenze Python nel dialog Module Dependencies: manifest e versione risolta dal lockfile, più i
 * CVE della scansione (quelli che l'editor del manifest mostra come lens). Nessuna azione di
 * modifica: aggiungere o aggiornare un pacchetto passa dal manifest o dal dialogo dell'ambiente.
 */
export function CodeStudioPythonDependencies({ session, units, onClose }: Props) {
  const [unit, setUnit] = useState(units[0]?.unit ?? '.')
  // Le unità arrivano dal progetto; il servizio aggiunge dipendenze e versioni risolte.
  const [state, setState] = useState<GoIDEPythonUnitDependencies[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const openDocument = useCodeStudioStore((store) => store.openDocument)
  const byDocument = usePythonSecurityStore((store) => store.byDocument)
  const documents = useCodeStudioStore((store) => store.documents)

  const load = async () => {
    setLoading(true); setError('')
    try {
      setState(await listPythonDependencies(session.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // Il manifest si legge quando il dialog si apre: nessun processo, nessuna installazione.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = state?.find((item) => item.unit === unit) ?? state?.[0]
  const root = unitRoot(session.project, current?.unit ?? '.')
  const relativeManifest = current?.dependencies[0]?.source ?? ''

  // I CVE arrivano dalla scansione del manifest aperto nell'editor (stesso store dell'editor).
  const document = documents.find((item) => normalize(item.document.path) === normalize(`${root}/${relativeManifest}`))
  const findings = Object.values(byDocument).flatMap((entry) => entry.findings)
  const statuses: PythonRequirementStatus[] = current && document
    ? pythonRequirementStatuses(parsePythonManifest(relativeManifest, document.buffer), findings)
    : []

  const worstOf = new Map<string, PythonRequirementStatus>()
  for (const status of statuses) if (status.worst) worstOf.set(status.requirement.name, status)

  const openManifest = () => {
    if (!relativeManifest) return
    const relative = current && current.unit !== '.' ? `${current.unit}/${relativeManifest}` : relativeManifest
    void openDocument(relative)
    onClose()
  }

  const pinned = current?.dependencies.filter((dependency) => dependency.version).length ?? 0
  const resolved = current?.dependencies.filter((dependency) => dependency.resolved).length ?? 0

  return <>
    {error && <CodeStudioAlert icon={AlertCircle}>{error}</CodeStudioAlert>}
    <div className="gs-dependencies-toolbar flex flex-wrap items-end gap-2">
      {state && state.length > 1 && (
        <CodeStudioField label="Unit" className="flex-1">
          <select value={unit} onChange={(event) => setUnit(event.target.value)} className="gs-input gs-mono">
            {state.map((item) => <option key={item.unit} value={item.unit}>{item.name} · {item.unit}</option>)}
          </select>
        </CodeStudioField>
      )}
      <CodeStudioButton variant="secondary" className="gs-btn-icon" disabled={loading} onClick={() => void load()} aria-label="Reload dependencies" title="Reload">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      </CodeStudioButton>
      <CodeStudioButton variant="secondary" icon={FileCode2} disabled={!relativeManifest} onClick={openManifest}>Open manifest</CodeStudioButton>
    </div>

    {!state && loading && <div className="gs-list-empty">Reading the Python manifests…</div>}
    {!units.length && <div className="gs-surface gs-list-empty">No Python unit in this project: open a folder with a pyproject.toml or a requirements.txt.</div>}

    {current && <>
      <div className="gs-nothing-summary flex flex-wrap items-center gap-2">
        <span className="gs-badge gs-mono">{relativeManifest || 'no manifest'}</span>
        {current.manager && <span className="gs-badge">{current.manager}</span>}
        {current.lockfile && <span className="gs-badge">{current.lockfile}</span>}
        <span className="gs-badge">{current.dependencies.length} dependence{current.dependencies.length === 1 ? '' : 's'}</span>
        <span className="gs-badge">{pinned} pinned</span>
        {resolved > 0 && <span className="gs-badge">{resolved} resolved</span>}
      </div>

      <div className="gs-list min-h-0 flex-1">
        {current.dependencies.length === 0 && <div className="gs-list-empty">This unit declares no dependency.</div>}
        {current.dependencies.map((dependency) => {
          const status = worstOf.get(dependency.name)
          return (
            <div key={`${dependency.source}:${dependency.name}`} className="gs-list-row">
              <div className="min-w-0 flex-1">
                <div className="gs-mono truncate text-text-1">{dependency.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-text-4">
                  <span className="gs-mono text-[11px]">{dependency.spec || dependency.resolved || 'unpinned'}</span>
                  {dependency.resolved && dependency.resolved !== dependency.version && <span className="gs-badge h-[18px] text-[10.5px]">resolved {dependency.resolved}</span>}
                  {dependency.dev && <span className="gs-badge h-[18px] text-[10.5px]">dev</span>}
                  {typeof dependency.line === 'number' && dependency.line > 0 && <span className="gs-mono text-[10.5px]">{dependency.source}:{dependency.line}</span>}
                </div>
              </div>
              <div className="gs-row-actions">
                {status
                  ? <span className="flex items-center gap-1 text-[11.5px] text-danger" title={status.vulnerabilities.map((item) => `${item.id} (${item.band})`).join('\n')}><ShieldAlert size={13} /> {status.worst?.toUpperCase()}{status.fixVersion ? ` · fixed in ${status.fixVersion}` : ''}</span>
                  : <span className="flex items-center gap-1 text-[11.5px] text-text-4"><ShieldCheck size={13} /> {document ? 'no advisory' : 'not scanned'}</span>}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[10.5px] text-text-4">Vulnerabilities come from the manifest open in the editor (Scan vulnerabilities). Adding or upgrading packages goes through the manifest or the environment dialog.</p>
    </>}
  </>
}
