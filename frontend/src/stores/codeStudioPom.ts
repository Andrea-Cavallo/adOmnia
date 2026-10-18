import { create } from 'zustand'
import type { PomDependency, VersionInfo } from '../../bindings/adomnia/internal/languages/java/models'
import { getPomDependencies, getPomManagedVersions, getPomVersions } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { isPomFile, mergeManagedVersions, projectRootOf, versionRequest } from '@/lib/code-studio/pomInsights'
import { scanWorkspaceSecurity, type SecurityFinding } from '@/lib/securityIntel-api'

/** Stato di un pom.xml aperto: versioni pubblicate e CVE arrivano solo da azioni esplicite dell'utente. */
export interface PomState {
  dependencies: PomDependency[]
  versions: VersionInfo[]
  findings: SecurityFinding[]
  checkingUpdates: boolean
  scanning: boolean
  updatesCheckedAt: string
  scannedAt: string
  error: string
}

const EMPTY: PomState = { dependencies: [], versions: [], findings: [], checkingUpdates: false, scanning: false, updatesCheckedAt: '', scannedAt: '', error: '' }

interface PomStore {
  byDocument: Record<string, PomState>
  /** Rilegge le coordinate dal testo dell'editor (locale, senza rete). */
  refreshDependencies: (documentId: string, sessionId: string, content: string) => Promise<void>
  checkUpdates: (documentId: string, sessionId: string, content: string) => Promise<void>
  scanVulnerabilities: (documentId: string, sessionId: string, absolutePath: string, relativePath: string) => Promise<void>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Coordinate del pom; quelle senza `<version>` ricevono la versione ereditata da parent/BOM (sola lettura). */
async function loadDependencies(documentId: string, sessionId: string, content: string): Promise<PomDependency[]> {
  const dependencies = await getPomDependencies(sessionId, content)
  const relativePath = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)?.document.relativePath ?? ''
  if (!isPomFile(relativePath) || !dependencies.some((item) => !item.resolved && !item.version)) return dependencies
  try {
    return mergeManagedVersions(dependencies, await getPomManagedVersions(sessionId, relativePath))
  } catch {
    return dependencies // parent/BOM illeggibili: le coordinate locali bastano
  }
}

export const usePomStore = create<PomStore>((set, get) => {
  const patch = (documentId: string, change: Partial<PomState>) =>
    set((state) => ({ byDocument: { ...state.byDocument, [documentId]: { ...(state.byDocument[documentId] ?? EMPTY), ...change } } }))
  return {
    byDocument: {},
    refreshDependencies: async (documentId, sessionId, content) => {
      try {
        patch(documentId, { dependencies: await loadDependencies(documentId, sessionId, content), error: '' })
      } catch (error) {
        // Un pom a metà digitazione non è ben formato: si tengono le ultime coordinate buone.
        patch(documentId, { error: message(error) })
      }
    },
    checkUpdates: async (documentId, sessionId, content) => {
      if (get().byDocument[documentId]?.checkingUpdates) return
      patch(documentId, { checkingUpdates: true, error: '' })
      try {
        const dependencies = await loadDependencies(documentId, sessionId, content)
        const request = versionRequest(dependencies)
        const versions = Object.keys(request).length ? await getPomVersions(sessionId, request) : []
        patch(documentId, { dependencies, versions, updatesCheckedAt: new Date().toISOString(), checkingUpdates: false })
      } catch (error) {
        patch(documentId, { checkingUpdates: false, error: message(error) })
      }
    },
    scanVulnerabilities: async (documentId, _sessionId, absolutePath, relativePath) => {
      if (get().byDocument[documentId]?.scanning) return
      patch(documentId, { scanning: true, error: '' })
      try {
        const report = await scanWorkspaceSecurity(projectRootOf(absolutePath, relativePath), { ecosystems: ['Maven'] })
        const normalize = (value: string) => value.split(String.fromCharCode(92)).join('/').toLowerCase()
        const own = report.findings.filter((finding) => !finding.component.manifest || normalize(finding.component.manifest) === normalize(absolutePath))
        patch(documentId, { findings: own, scannedAt: new Date().toISOString(), scanning: false })
      } catch (error) {
        patch(documentId, { scanning: false, error: message(error) })
      }
    },
  }
})
