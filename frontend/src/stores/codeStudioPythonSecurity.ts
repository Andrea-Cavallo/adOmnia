import { create } from 'zustand'
import { scanWorkspaceSecurity, type SecurityFinding } from '@/lib/securityIntel-api'
import { projectRootOf } from '@/lib/code-studio/pomInsights'

/** CVE di un manifest Python aperto: arrivano solo da una scansione esplicita (solo coordinate verso OSV). */
export interface PythonSecurityState {
  findings: SecurityFinding[]
  scanning: boolean
  scannedAt: string
  error: string
}

const EMPTY: PythonSecurityState = { findings: [], scanning: false, scannedAt: '', error: '' }

interface PythonSecurityStore {
  byDocument: Record<string, PythonSecurityState>
  scan: (documentId: string, absolutePath: string, relativePath: string) => Promise<void>
}

const normalize = (value: string) => value.split(String.fromCharCode(92)).join('/').toLowerCase()

/**
 * Scansiona l'ecosistema PyPI del progetto e tiene solo i finding del manifest aperto: il motore
 * risolve lockfile e requirements, l'editor mostra le righe di quel file.
 */
export const usePythonSecurityStore = create<PythonSecurityStore>((set, get) => {
  const patch = (documentId: string, change: Partial<PythonSecurityState>) =>
    set((state) => ({ byDocument: { ...state.byDocument, [documentId]: { ...(state.byDocument[documentId] ?? EMPTY), ...change } } }))
  return {
    byDocument: {},
    scan: async (documentId, absolutePath, relativePath) => {
      if (get().byDocument[documentId]?.scanning) return
      patch(documentId, { scanning: true, error: '' })
      try {
        const report = await scanWorkspaceSecurity(projectRootOf(absolutePath, relativePath), { ecosystems: ['PyPI'] })
        const own = report.findings.filter((finding) => !finding.component.manifest || normalize(finding.component.manifest) === normalize(absolutePath))
        patch(documentId, { findings: own, scannedAt: new Date().toISOString(), scanning: false })
      } catch (error) {
        patch(documentId, { scanning: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
})

export { EMPTY as EMPTY_PYTHON_SECURITY_STATE }
