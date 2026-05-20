import { useState, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import {
  scanWorkspace,
  generateMarkdownReport,
  maskSecretValues,
  type SecretFinding,
  type RiskLevel,
  type ScanReport,
} from '@/lib/secretScanner'
import {
  Shield,
  Search,
  Download,
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldCheck,
  Eye,
  EyeOff,
  FileWarning,
  Lock,
  ArrowRight,
  Copy,
  Scan,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<RiskLevel, { icon: typeof AlertTriangle; className: string; label: string; badgeClass: string }> = {
  high: { icon: AlertCircle, className: 'text-red-400', label: 'HIGH', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30' },
  medium: { icon: AlertTriangle, className: 'text-yellow-400', label: 'MED', badgeClass: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  low: { icon: Info, className: 'text-blue-400', label: 'LOW', badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
}

const TYPE_LABELS: Record<SecretFinding['type'], string> = {
  bearer_token: 'Bearer / JWT',
  api_key: 'API Key',
  aws_secret: 'AWS Secret',
  password: 'Password',
  private_key: 'Private Key',
  connection_string: 'Connection String',
  high_entropy: 'High Entropy',
  sensitive_key: 'Sensitive Key',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SecretScannerPanel() {
  const collections = useCollectionsStore((s) => s.collections)
  const environments = useEnvironmentsStore((s) => s.environments)

  const [report, setReport] = useState<ScanReport | null>(null)
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [showValue, setShowValue] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleScan = useCallback(() => {
    const result = scanWorkspace({ collections, environments })
    setReport(result)
    setShowValue(new Set())
  }, [collections, environments])

  const handleExportReport = useCallback(() => {
    if (!report) return
    const md = generateMarkdownReport(report)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adomnia-security-scan-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [report])

  const handleCopyFinding = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const toggleValue = useCallback((id: string) => {
    setShowValue((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const filtered = useMemo(() => {
    if (!report) return []
    return report.findings.filter((f) => {
      if (riskFilter !== 'all' && f.risk !== riskFilter) return false
      if (searchFilter) {
        const q = searchFilter.toLowerCase()
        const haystack = [f.key, f.location, f.type, f.hint].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [report, riskFilter, searchFilter])

  const workspaceData = useMemo(() => ({
    collections,
    environments,
  }), [collections, environments])

  const [maskedExportVisible, setMaskedExportVisible] = useState(false)
  const [maskedPreview, setMaskedPreview] = useState('')

  const handleMaskedPreview = useCallback(() => {
    const masked = maskSecretValues(workspaceData)
    setMaskedPreview(JSON.stringify(masked, null, 2))
    setMaskedExportVisible(true)
  }, [workspaceData])

  const handleExportMasked = useCallback(() => {
    const blob = new Blob([maskedPreview], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adomnia-masked-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [maskedPreview])

  // Stats
  const counts = report?.riskCounts ?? { high: 0, medium: 0, low: 0 }
  const hasHigh = counts.high > 0
  const hasFindings = report && report.totalFindings > 0

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center h-10 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Shield size={14} className={hasHigh ? 'text-red-400' : 'text-accent'} />
        <span className="text-[10px] font-semibold text-text-1 uppercase tracking-wider">
          Secret Scanner
        </span>

        <button
          onClick={handleScan}
          className="h-7 px-3 rounded bg-accent/10 border border-accent/30 text-xs text-accent font-medium hover:bg-accent/20 transition-colors flex items-center gap-1.5"
        >
          <Scan size={12} />
          Scan Workspace
        </button>

        {report && (
          <>
            <div className="w-px h-5 bg-border-1" />
            <span className={cn(
              'text-[10px] font-medium',
              hasHigh ? 'text-red-400' : hasFindings ? 'text-yellow-400' : 'text-emerald-400',
            )}>
              {report.totalFindings === 0
                ? 'Clean'
                : `${report.totalFindings} finding${report.totalFindings > 1 ? 's' : ''}`}
            </span>

            <div className="flex-1" />

            <button
              onClick={handleExportReport}
              className="h-7 px-2 rounded bg-surface-2 border border-border-1 text-[10px] text-text-2 hover:text-text-1 transition-colors flex items-center gap-1"
            >
              <Download size={10} />
              Export Report
            </button>

            <button
              onClick={handleMaskedPreview}
              className="h-7 px-2 rounded bg-surface-2 border border-border-1 text-[10px] text-text-2 hover:text-text-1 transition-colors flex items-center gap-1"
            >
              <EyeOff size={10} />
              Masked Export
            </button>
          </>
        )}
      </div>

      {/* ── Risk summary bar ─────────────────────────────────────────── */}
      {report && (
        <div className="flex items-center h-7 px-3 gap-3 border-b border-border-1 bg-surface-0 flex-shrink-0">
          <span className="text-[9px] text-text-3 uppercase tracking-wider">
            Risk:
          </span>
          {(['high', 'medium', 'low'] as RiskLevel[]).map((level) => {
            const config = RISK_CONFIG[level]
            const Icon = config.icon
            return (
              <button
                key={level}
                onClick={() => setRiskFilter(riskFilter === level ? 'all' : level)}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors',
                  riskFilter === level || riskFilter === 'all'
                    ? config.className
                    : 'text-text-3 opacity-40',
                )}
              >
                <Icon size={8} />
                {config.label}:{counts[level]}
              </button>
            )
          })}
          {riskFilter !== 'all' && (
            <button
              onClick={() => setRiskFilter('all')}
              className="text-[8px] text-text-3 hover:text-text-1"
            >
              (clear)
            </button>
          )}

          <div className="flex-1" />

          <div className="relative">
            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter findings..."
              className="h-5 w-40 pl-5 pr-2 rounded bg-surface-1 border border-border-1 text-[9px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {!report && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-3">
          <ShieldCheck size={32} className="opacity-20" />
          <span className="text-xs">Click "Scan Workspace" to scan for secrets</span>
          <span className="text-[10px] opacity-50 max-w-xs text-center">
            Detects Bearer tokens, API keys, passwords, AWS secrets, PEM private keys, connection strings, and high-entropy values across all collections and environments.
          </span>
        </div>
      )}

      {/* ── Clean result ─────────────────────────────────────────────── */}
      {report && report.totalFindings === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-3">
          <ShieldCheck size={32} className="text-emerald-400 opacity-40" />
          <span className="text-xs text-emerald-400">Workspace is clean</span>
          <span className="text-[10px] opacity-50">No secrets detected in {collections.length} collections and {environments.length} environments.</span>
        </div>
      )}

      {/* ── Findings list ────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {filtered.map((finding) => {
            const config = RISK_CONFIG[finding.risk]
            const visible = showValue.has(finding.id)

            return (
              <div
                key={finding.id}
                className="rounded border border-border-1 bg-surface-0 overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-1/50">
                  <span className={cn('text-[8px] font-bold px-1.5 py-0.5 rounded border', config.badgeClass)}>
                    {config.label}
                  </span>
                  <span className="text-[10px] text-text-1 font-medium">
                    {TYPE_LABELS[finding.type]}
                  </span>
                  <span className="text-[9px] text-text-3 flex-1 truncate ml-2">
                    {finding.location}
                  </span>
                  <button
                    onClick={() => toggleValue(finding.id)}
                    className="h-5 px-1.5 rounded text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors flex items-center gap-1 text-[9px]"
                  >
                    {visible ? <EyeOff size={10} /> : <Eye size={10} />}
                    {visible ? 'Hide' : 'Show'}
                  </button>
                  <button
                    onClick={() => handleCopyFinding(finding.fullValue, finding.id)}
                    className="h-5 px-1.5 rounded text-text-3 hover:text-accent hover:bg-accent/10 transition-colors flex items-center gap-1 text-[9px]"
                  >
                    <Copy size={10} />
                    {copiedId === finding.id ? 'Copied' : 'Copy'}
                  </button>
                </div>

                {/* Body */}
                <div className="px-3 py-2 space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[9px] text-text-3 uppercase w-6 flex-shrink-0">Key:</span>
                    <span className="text-[10px] text-accent font-mono">{finding.key}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[9px] text-text-3 uppercase w-6 flex-shrink-0">Val:</span>
                    <span className="text-[10px] text-text-2 font-mono break-all">
                      {visible ? finding.fullValue : finding.hint}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Lock size={10} className="text-text-3 mt-0.5 flex-shrink-0" />
                    <span className="text-[9px] text-text-3">{finding.suggestion}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Masked export modal ──────────────────────────────────────── */}
      {maskedExportVisible && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-[600px] max-h-[80vh] bg-surface-0 border border-border-2 rounded-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center h-8 px-3 gap-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
              <FileWarning size={12} className="text-yellow-400" />
              <span className="text-[10px] font-semibold text-text-1 uppercase tracking-wider">
                Masked Workspace Preview
              </span>
              <div className="flex-1" />
              <button
                onClick={handleExportMasked}
                className="h-6 px-2 rounded bg-accent/10 border border-accent/30 text-[10px] text-accent font-medium hover:bg-accent/20 transition-colors flex items-center gap-1"
              >
                <Download size={10} />
                Download
              </button>
              <button
                onClick={() => setMaskedExportVisible(false)}
                className="h-6 px-2 rounded text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors text-[10px]"
              >
                Close
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono text-text-2 whitespace-pre-wrap">
              {maskedPreview}
            </pre>
          </div>
        </div>
      )}

      {/* ── Status bar ───────────────────────────────────────────────── */}
      <div className="flex items-center h-6 px-3 gap-3 border-t border-border-1 bg-surface-0 flex-shrink-0">
        <ArrowRight size={10} className="text-text-3" />
        <span className="text-[9px] text-text-3">
          {report
            ? `Scanned ${collections.length} collections · ${environments.length} environments · ${report.totalFindings} findings`
            : `${collections.length} collections · ${environments.length} environments · ready to scan`}
        </span>
      </div>
    </div>
  )
}
