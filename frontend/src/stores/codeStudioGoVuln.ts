import { create } from 'zustand'
import { scanWorkspaceSecurity, type SecurityFinding } from '@/lib/securityIntel-api'
import { detectGoIDEGoTool } from '@/lib/code-studio-api'
import { projectRootOf } from '@/lib/code-studio/pomInsights'

/** CVE di un go.mod aperto: arrivano solo da una scansione esplicita dell'utente (solo coordinate verso OSV). */
export interface GoVulnState {
  findings: SecurityFinding[]
  scanning: boolean
  scannedAt: string
  error: string
  /** govulncheck serve alla raggiungibilità: senza, i finding restano "required". unknown finché non si è scansionato. */
  govulncheck: 'unknown' | 'present' | 'missing'
}

const EMPTY: GoVulnState = { findings: [], scanning: false, scannedAt: '', error: '', govulncheck: 'unknown' }

interface GoVulnStore {
  byDocument: Record<string, GoVulnState>
  scan: (documentId: string, sessionId: string, absolutePath: string, relativePath: string) => Promise<void>
}

const normalize = (value: string) => value.split(String.fromCharCode(92)).join('/').toLowerCase()

export const useGoVulnStore = create<GoVulnStore>((set, get) => {
  const patch = (documentId: string, change: Partial<GoVulnState>) =>
    set((state) => ({ byDocument: { ...state.byDocument, [documentId]: { ...(state.byDocument[documentId] ?? EMPTY), ...change } } }))
  return {
    byDocument: {},
    scan: async (documentId, sessionId, absolutePath, relativePath) => {
      if (get().byDocument[documentId]?.scanning) return
      patch(documentId, { scanning: true, error: '' })
      try {
        const report = await scanWorkspaceSecurity(projectRootOf(absolutePath, relativePath), { ecosystems: ['Go'] })
        const own = report.findings.filter((finding) => !finding.component.manifest || normalize(finding.component.manifest) === normalize(absolutePath))
        const tool = await detectGoIDEGoTool(sessionId, 'govulncheck').catch(() => null)
        patch(documentId, { findings: own, scannedAt: new Date().toISOString(), scanning: false, govulncheck: tool?.available ? 'present' : 'missing' })
      } catch (error) {
        patch(documentId, { scanning: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
})

export { EMPTY as EMPTY_GO_VULN_STATE }
