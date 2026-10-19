import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowUpCircle, FileCode2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { MavenBuildUnit } from '@/lib/code-studio/mavenUnits'
import { dependencyStatuses, updateEdit, type PomDependencyStatus } from '@/lib/code-studio/pomInsights'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { usePomStore } from '@/stores/codeStudioPom'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField } from './CodeStudioModal'
import { applyPomUpdate } from './codeStudioPom'

const EMPTY: ReturnType<typeof usePomStore.getState>['byDocument'][string] = { dependencies: [], versions: [], findings: [], checkingUpdates: false, scanning: false, updatesCheckedAt: '', scannedAt: '', error: '' }
const normalize = (path: string) => path.replace(/\\/g, '/')

function relativeTo(project: GoIDESession['project'], absolute: string): string {
  const root = normalize(project.rootPath ?? '').replace(/\/$/, '')
  const path = normalize(absolute)
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

const BAND_CLASS: Record<string, string> = { critical: 'text-danger', high: 'text-danger', medium: 'text-warning', low: 'text-text-3', informational: 'text-text-4' }

interface Props {
  session: GoIDESession
  units: MavenBuildUnit[]
  onClose: () => void
}

/** Dipendenze Maven/Gradle nel dialog Module Dependencies: stessi dati, scansione CVE e aggiornamenti dell'editor del pom. */
export function CodeStudioMavenDependencies({ session, units, onClose }: Props) {
  const [manifest, setManifest] = useState(units[0]?.manifest ?? '')
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const relativePath = manifest ? relativeTo(session.project, manifest) : ''
  const state = usePomStore((store) => (documentId ? store.byDocument[documentId] : undefined)) ?? EMPTY
  const buffer = useCodeStudioStore((store) => store.documents.find((item) => item.document.id === documentId)?.buffer ?? '')
  const unit = units.find((item) => item.manifest === manifest)

  // Il manifest si apre come tab normale: gli aggiornamenti sono edit dell'editor (annullabili, da salvare).
  useEffect(() => {
    let current = true
    setDocumentId(null); setError('')
    if (!relativePath) return
    void useCodeStudioStore.getState().openDocument(relativePath, { preview: true }).then((id) => { if (current) setDocumentId(id) }).catch((reason) => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [relativePath])

  useEffect(() => {
    if (documentId && buffer) void usePomStore.getState().refreshDependencies(documentId, session.id, buffer)
  }, [documentId, buffer, session.id])

  const statuses = useMemo(() => dependencyStatuses(state.dependencies, state.versions, state.findings), [state.dependencies, state.versions, state.findings])
  const vulnerable = statuses.filter((status) => status.worst || status.viaThis.length > 0).length
  const busy = state.checkingUpdates || state.scanning

  const checkUpdates = () => documentId && void usePomStore.getState().checkUpdates(documentId, session.id, buffer)
  const scan = () => documentId && void usePomStore.getState().scanVulnerabilities(documentId, session.id, manifest, relativePath)
  const goTo = (status: PomDependencyStatus) => void useCodeStudioStore.getState().openLocation(relativePath, status.dependency.line, status.dependency.startColumn)
  const update = (status: PomDependencyStatus, version: string) => { if (documentId) applyPomUpdate(documentId, status.dependency.line, version) }

  return <>
    {(error || state.error) && <CodeStudioAlert icon={AlertCircle}>{error || state.error}</CodeStudioAlert>}
    <div className="flex items-end gap-2">
      <CodeStudioField label={unit?.kind === 'gradle' ? 'Gradle project' : 'Maven project'} className="flex-1">
        <select value={manifest} onChange={(event) => setManifest(event.target.value)} className="gs-input gs-mono">
          {units.map((item) => <option key={item.manifest} value={item.manifest}>{item.name} · {relativeTo(session.project, item.manifest)}</option>)}
        </select>
      </CodeStudioField>
      <CodeStudioButton variant="secondary" disabled={!documentId || busy} onClick={checkUpdates} title="Looks up the latest stable versions on Maven Central (network)">
        {state.checkingUpdates ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check updates
      </CodeStudioButton>
      <CodeStudioButton variant="secondary" disabled={!documentId || busy} onClick={scan} title="Matches the dependencies, transitive ones included, against OSV (only coordinates and versions leave your machine)">
        {state.scanning ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} />} Scan vulnerabilities
      </CodeStudioButton>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <span className="gs-badge">{statuses.length} dependenc{statuses.length === 1 ? 'y' : 'ies'}</span>
      {state.scannedAt && <span className={`gs-badge ${vulnerable ? 'text-danger' : 'text-success'}`}>{vulnerable ? `${vulnerable} with vulnerabilities` : 'no known vulnerabilities'}</span>}
      {state.updatesCheckedAt && <span className="gs-badge">{statuses.filter((status) => status.version?.newer).length} with updates</span>}
    </div>
    <div className="gs-list min-h-0 flex-1">
      {!documentId && !error && <div className="gs-list-empty">Reading {relativePath || 'the build file'}…</div>}
      {documentId && statuses.length === 0 && <div className="gs-list-empty">No dependencies with coordinates in this file.</div>}
      {statuses.map((status) => {
        const { dependency } = status
        const targets = [
          status.fixVersion && status.fixVersion !== dependency.resolved ? { version: status.fixVersion, label: `Fix ${status.fixVersion}`, security: true } : null,
          status.version?.newer && status.version.latest && status.version.latest !== status.fixVersion ? { version: status.version.latest, label: `Update ${status.version.latest}`, security: false } : null,
        ].filter((item): item is { version: string; label: string; security: boolean } => !!item)
        const editable = !!updateEdit(dependency, targets[0]?.version ?? 'x')
        return <div key={`${dependency.section}:${status.key}:${dependency.line}`} className="gs-list-row">
          <div className="min-w-0 flex-1">
            <div className="gs-mono truncate text-text-1">{status.key}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-4">
              <span className="gs-mono text-[11px]">{dependency.resolved || dependency.version || 'managed'}</span>
              {dependency.scope && <span className="gs-badge h-[18px] text-[10.5px]">{dependency.scope}</span>}
              {dependency.section !== 'dependencies' && <span className="gs-badge h-[18px] text-[10.5px]">{dependency.section}</span>}
              {'managedBy' in dependency && !!dependency.managedBy && <span className="gs-badge h-[18px] text-[10.5px]" title="Version inherited from a parent or BOM: update it where it is defined">managed</span>}
              {status.worst && <span className={`flex items-center gap-1 ${BAND_CLASS[status.worst]}`}><ShieldAlert size={11} />{status.vulnerabilities[0].id}{status.vulnerabilities.length > 1 ? ` +${status.vulnerabilities.length - 1}` : ''} · {status.worst}</span>}
              {status.viaThis.length > 0 && <span className="flex items-center gap-1 text-warning" title={status.viaThis.map((item) => `${item.id} in ${item.component}`).join('\n')}><ShieldAlert size={11} />brings in {status.viaThis[0].component}{status.viaThis.length > 1 ? ` +${status.viaThis.length - 1}` : ''}</span>}
              {!status.worst && state.scannedAt && status.viaThis.length === 0 && <ShieldCheck size={11} className="text-success" aria-label="No known vulnerabilities" />}
              {status.version?.newer && <span className="text-accent">latest {status.version.latest}</span>}
            </div>
          </div>
          <div className="gs-row-actions">
            {editable && targets.map((target) => <CodeStudioButton key={target.version} small variant="ghost" icon={ArrowUpCircle} onClick={() => update(status, target.version)} title={target.security ? 'Security fix: edits the version in the editor (Ctrl+Z to undo, save to keep)' : 'Edits the version in the editor (Ctrl+Z to undo, save to keep)'}>{target.label}</CodeStudioButton>)}
            <CodeStudioButton small variant="ghost" className="gs-btn-icon" onClick={() => { goTo(status); onClose() }} aria-label={`Open ${status.key} in ${relativePath}`} title="Open at this line"><FileCode2 size={13} /></CodeStudioButton>
          </div>
        </div>
      })}
    </div>
    <p className="text-[11.5px] text-text-4">Updates are edits to {relativePath || 'the build file'} in the editor: review, undo or save them there. Nothing is downloaded or built.</p>
  </>
}

