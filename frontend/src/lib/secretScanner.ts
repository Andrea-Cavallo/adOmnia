// ─── Secret Scanner Engine ───────────────────────────────────────────────────
// Local-first, no external calls. Detects secrets by both key name and value pattern.

import type { Collection, Environment, TreeNode, RequestItem, RequestAuth, KVRow } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high'
export type SecretType = 'bearer_token' | 'api_key' | 'aws_secret' | 'password' | 'private_key' | 'connection_string' | 'high_entropy' | 'sensitive_key'

export interface SecretFinding {
  id: string
  type: SecretType
  risk: RiskLevel
  location: string        // e.g. "Collection > API / Request POST /api/login / Auth"
  key: string             // the field name or context
  hint: string            // partial redacted value for user recognition: "sk-***...abc"
  fullValue: string       // full value (for masking)
  suggestion: string      // actionable suggestion
}

export interface ScanReport {
  scannedAt: string
  totalFindings: number
  findings: SecretFinding[]
  riskCounts: Record<RiskLevel, number>
  summary: string
}

// ─── Detection patterns ───────────────────────────────────────────────────────

interface PatternDef {
  type: SecretType
  risk: RiskLevel
  regex: RegExp
  label: string
  suggestion: string
}

const PATTERNS: PatternDef[] = [
  // Bearer tokens / JWT
  {
    type: 'bearer_token',
    risk: 'high',
    regex: /eyJ[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]*/g,
    label: 'JWT / Bearer token',
    suggestion: 'Store in Vault. Tokens are short-lived credentials that should not be exported.',
  },
  {
    type: 'bearer_token',
    risk: 'high',
    regex: /Bearer\s+([A-Za-z0-9\-._~+/]+=*){20,}/gi,
    label: 'Bearer token (authorization header)',
    suggestion: 'Store in Vault. Rotate token if it has been shared.',
  },
  // GitHub tokens
  {
    type: 'api_key',
    risk: 'high',
    regex: /ghp_[A-Za-z0-9_]{36,}/g,
    label: 'GitHub Personal Access Token',
    suggestion: 'Move to Vault immediately. GitHub tokens grant repo access.',
  },
  {
    type: 'api_key',
    risk: 'high',
    regex: /github_pat_[A-Za-z0-9_]{36,}/g,
    label: 'GitHub Fine-grained PAT',
    suggestion: 'Move to Vault immediately. Rotate if exposed.',
  },
  // Stripe keys
  {
    type: 'api_key',
    risk: 'high',
    regex: /sk_live_[A-Za-z0-9]{24,}/g,
    label: 'Stripe secret key (live)',
    suggestion: 'Store in Vault. Live Stripe keys can charge real money.',
  },
  {
    type: 'api_key',
    risk: 'medium',
    regex: /sk_test_[A-Za-z0-9]{24,}/g,
    label: 'Stripe secret key (test)',
    suggestion: 'Store in Vault. Even test keys should not be shared openly.',
  },
  {
    type: 'api_key',
    risk: 'medium',
    regex: /rk_live_[A-Za-z0-9]{24,}/g,
    label: 'Stripe restricted key (live)',
    suggestion: 'Store in Vault.',
  },
  // Slack tokens
  {
    type: 'api_key',
    risk: 'medium',
    regex: /xox[bprs]-[A-Za-z0-9\-]{10,}/g,
    label: 'Slack bot/user token',
    suggestion: 'Store in Vault. Slack tokens grant messaging/reading access.',
  },
  // Generic API key patterns (sk-, pk- prefixes common to many services)
  {
    type: 'api_key',
    risk: 'medium',
    regex: /\b(sk|pk|ak|tk)_[A-Za-z0-9]{20,}\b/g,
    label: 'Generic API key (sk-/pk-/ak-/tk- prefix)',
    suggestion: 'Verify what service this belongs to and store securely.',
  },
  // AWS keys
  {
    type: 'aws_secret',
    risk: 'high',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    label: 'AWS Access Key ID',
    suggestion: 'Store in Vault. AWS keys grant cloud resource access.',
  },
  {
    type: 'aws_secret',
    risk: 'high',
    regex: /\b[0-9a-zA-Z/+]{40}\b/g,
    label: 'AWS Secret Access Key (potential)',
    suggestion: 'Verify if this is an AWS secret key. Store in Vault.',
  },
  // PEM private keys
  {
    type: 'private_key',
    risk: 'high',
    regex: /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/gi,
    label: 'Private key (PEM)',
    suggestion: 'Store in Vault. Private keys are root credentials. Rotate if exposed.',
  },
  // Connection strings with embedded credentials
  {
    type: 'connection_string',
    risk: 'high',
    regex: /(mongodb|mysql|postgres|postgresql|redis|rediss|amqp|amqps|mssql|sqlserver):\/\/[^:@\s]+:[^@\s]+@/gi,
    label: 'Connection string with embedded password',
    suggestion: 'Extract credentials to Vault. Use environment variables for the connection URL.',
  },
  // Passwords in key=value format
  {
    type: 'password',
    risk: 'high',
    regex: /(?:password|passwd|pwd|pass|secret)\s*[:=]\s*['"]?(\S{4,})/gi,
    label: 'Password in plaintext',
    suggestion: 'Store in Vault. Passwords should never be in plaintext files.',
  },
]

// Key-based patterns (lower risk — only flag if value looks sensitive)
const SENSITIVE_KEYS = /^(authorization|token|secret|password|passwd|apikey|api_key|api[-_]?secret|client_secret|private[_-]?key|access[_-]?key|secret[_-]?key|jwt)$/i

// High-entropy detection: flags random-looking strings 20-50 chars
function shannonEntropy(str: string): number {
  if (str.length < 20) return 0
  const freq: Record<string, number> = {}
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1
  return -Object.values(freq).reduce((sum, f) => {
    const p = f / str.length
    return sum + p * Math.log2(p)
  }, 0)
}

// ─── Scanning functions ───────────────────────────────────────────────────────

let nextId = 0
function fid(): string { return `sec-${++nextId}` }

function maskValue(value: string): string {
  if (value.length <= 6) return '***'
  if (value.length <= 12) return value.slice(0, 3) + '***'
  return value.slice(0, 4) + '***...' + value.slice(-3)
}

function scanText(value: string, location: string, key: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  if (!value || value.length < 4) return findings

  for (const pattern of PATTERNS) {
    const matches = value.matchAll(pattern.regex)
    for (const match of matches) {
      const fullValue = match[0]
      // Skip generic AWS 40-char pattern if it matches a more specific pattern already
      if (pattern.type === 'aws_secret' && pattern.label.includes('potential')) {
        // Only flag if entropy is high enough
        if (shannonEntropy(fullValue) < 3.5) continue
      }
      findings.push({
        id: fid(),
        type: pattern.type,
        risk: pattern.risk,
        location,
        key,
        hint: maskValue(fullValue),
        fullValue,
        suggestion: pattern.suggestion,
      })
    }
  }

  return findings
}

function scanKeyValue(key: string, value: string, location: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  if (!value || value.length < 4) return findings

  // Check key name
  if (SENSITIVE_KEYS.test(key)) {
    findings.push({
      id: fid(),
      type: 'sensitive_key',
      risk: value.length > 10 ? 'high' : 'low',
      location,
      key,
      hint: maskValue(value),
      fullValue: value,
      suggestion: 'Store in Vault. Sensitive values should be encrypted at rest.',
    })
  }

  // Check value patterns
  findings.push(...scanText(value, location, key))

  // Additional high-entropy check
  if (value.length >= 20 && value.length <= 200 && shannonEntropy(value) >= 4.0) {
    // Only flag if it looks like a token/key (not a long sentence)
    if (!/\s/.test(value) && /[A-Za-z0-9\-_=+/]{20,}/.test(value)) {
      findings.push({
        id: fid(),
        type: 'high_entropy',
        risk: 'medium',
        location,
        key,
        hint: maskValue(value),
        fullValue: value,
        suggestion: 'High-entropy value detected. Verify if this is a credential and store in Vault.',
      })
    }
  }

  return findings
}

function scanKVRow(rows: KVRow[], location: string): SecretFinding[] {
  return rows.flatMap((row) => {
    if (!row.key || !row.value) return []
    return scanKeyValue(row.key, row.value, `${location} / ${row.key}`)
  })
}

function scanAuth(auth: RequestAuth, location: string): SecretFinding[] {
  const findings: SecretFinding[] = []

  if (auth.token) {
    findings.push(...scanKeyValue('token', auth.token, `${location} / Token`))
  }
  if (auth.password) {
    findings.push(...scanKeyValue('password', auth.password, `${location} / Password`))
  }
  if (auth.username && auth.password) {
    findings.push({
      id: fid(),
      type: 'password',
      risk: 'high',
      location: `${location} / Basic Auth`,
      key: 'username+password',
      hint: `${auth.username}:${maskValue(auth.password)}`,
      fullValue: `${auth.username}:${auth.password}`,
      suggestion: 'Store credentials in Vault. Use variables for Basic Auth.',
    })
  }
  if ((auth as any).oauth2ClientSecret) {
    findings.push(...scanKeyValue('oauth2_client_secret', (auth as any).oauth2ClientSecret, `${location} / OAuth2 Client Secret`))
  }
  if ((auth as any).awsSecretKey) {
    findings.push(...scanKeyValue('aws_secret_key', (auth as any).awsSecretKey, `${location} / AWS Secret Key`))
  }
  if ((auth as any).awsAccessKeyId) {
    findings.push(...scanKeyValue('aws_access_key', (auth as any).awsAccessKeyId, `${location} / AWS Access Key`))
  }

  return findings
}

function scanRequestBody(body: { raw?: string; type?: string; form?: KVRow[] }, name: string, location: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const bodyLoc = `${location} / Body ${name}`

  if (body.raw) {
    findings.push(...scanText(body.raw, bodyLoc, 'raw_body'))
  }
  if (body.form) {
    findings.push(...scanKVRow(body.form, bodyLoc))
  }
  return findings
}

function scanRequestItem(item: RequestItem, location: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const reqLoc = `${location} [${item.method} ${item.url || item.name}]`

  // Scan URL for embedded credentials
  if (item.url) {
    findings.push(...scanText(item.url, reqLoc, 'url'))
  }

  // Scan headers
  findings.push(...scanKVRow(item.headers, `${reqLoc} / Headers`))

  // Scan params
  findings.push(...scanKVRow(item.params, `${reqLoc} / Params`))

  // Scan auth
  if (item.auth.type !== 'none') {
    findings.push(...scanAuth(item.auth, `${reqLoc} / Auth`))
  }

  // Scan body
  item.bodies.forEach((body, idx) => {
    if (body.type !== 'none') {
      findings.push(...scanRequestBody(body, body.name || `Body ${idx + 1}`, reqLoc))
    }
  })

  // Scan scripts
  if (item.scripts?.pre) findings.push(...scanText(item.scripts.pre, `${reqLoc} / Pre-request Script`, 'pre_script'))
  if (item.scripts?.post) findings.push(...scanText(item.scripts.post, `${reqLoc} / Post-response Script`, 'post_script'))
  if (item.scripts?.tests) findings.push(...scanText(item.scripts.tests, `${reqLoc} / Test Script`, 'test_script'))

  return findings
}

function scanTreeNodes(nodes: TreeNode[], parentPath: string): SecretFinding[] {
  return nodes.flatMap((node) => {
    const path = parentPath ? `${parentPath} > ${node.name}` : node.name
    if (node.type === 'request') {
      return scanRequestItem(node as RequestItem, path)
    }
    if (node.type === 'folder' && (node as any).children) {
      return scanTreeNodes((node as any).children, path)
    }
    return []
  })
}

function scanEnvironment(env: Environment, _envId: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const loc = `Environment: ${env.name}`

  env.variables.forEach((v) => {
    if (!v.enabled) return
    if (v.type === 'secret') {
      findings.push({
        id: fid(),
        type: 'sensitive_key',
        risk: 'low',
        location: loc,
        key: v.key,
        hint: maskValue(v.value),
        fullValue: v.value,
        suggestion: `Variable "${v.key}" is already marked as secret (masked in UI). Consider moving to Vault.`,
      })
      return
    }
    if (v.value && v.value.length >= 4) {
      findings.push(...scanKeyValue(v.key, v.value, `${loc} / ${v.key}`))
    }
  })

  return findings
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ScanInput {
  collections: Collection[]
  environments: Environment[]
}

export function scanWorkspace(input: ScanInput): ScanReport {
  nextId = 0
  const findings: SecretFinding[] = []

  // Scan collections
  input.collections.forEach((col) => {
    findings.push(...scanTreeNodes(col.children, `Collection: ${col.name}`))
  })

  // Scan environments
  input.environments.forEach((env) => {
    findings.push(...scanEnvironment(env, env.id))
  })

  // Deduplicate by fullValue + location
  const seen = new Set<string>()
  const unique = findings.filter((f) => {
    const key = `${f.location}|${f.key}|${f.fullValue}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const riskCounts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 }
  unique.forEach((f) => riskCounts[f.risk]++)

  const highCount = riskCounts.high
  const mediumCount = riskCounts.medium

  let summary = 'No secrets detected. Your workspace appears clean.'
  if (highCount > 0 && mediumCount > 0) {
    summary = `${highCount} high-risk and ${mediumCount} medium-risk secrets found. Review and move credentials to Vault before exporting.`
  } else if (highCount > 0) {
    summary = `${highCount} high-risk secrets found. These should be moved to Vault immediately.`
  } else if (mediumCount > 0) {
    summary = `${mediumCount} medium-risk findings. Consider securing these values.`
  } else if (riskCounts.low > 0) {
    summary = `${riskCounts.low} low-risk findings. Review and consider moving sensitive values to Vault.`
  }

  return {
    scannedAt: new Date().toISOString(),
    totalFindings: unique.length,
    findings: unique,
    riskCounts,
    summary,
  }
}

export function maskSecretValues(obj: unknown): unknown {
  const walk = (input: unknown, key = ''): unknown => {
    if (input == null) return input
    if (typeof input === 'string') {
      if (!input || input.length < 4) return input
      // Check key name
      if (SENSITIVE_KEYS.test(key)) return '***REDACTED***'
      // Check value patterns
      for (const pattern of PATTERNS) {
        if (pattern.regex.test(input)) {
          pattern.regex.lastIndex = 0
          return '***REDACTED***'
        }
      }
      return input
    }
    if (Array.isArray(input)) return input.map((item) => walk(item, key))
    if (typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)])
      )
    }
    return input
  }
  return walk(obj)
}

export function generateMarkdownReport(report: ScanReport): string {
  const lines: string[] = [
    '# adOmnia Security Scan Report',
    `**Scanned:** ${new Date(report.scannedAt).toLocaleString()}`,
    `**Total findings:** ${report.totalFindings}`,
    '',
    '## Risk Summary',
    `-   **High:** ${report.riskCounts.high}`,
    `-   **Medium:** ${report.riskCounts.medium}`,
    `-   **Low:** ${report.riskCounts.low}`,
    '',
    report.summary,
    '',
  ]

  if (report.findings.length > 0) {
    lines.push('## Findings', '')

    const byRisk = (level: RiskLevel) =>
      report.findings.filter((f) => f.risk === level)

    for (const level of ['high', 'medium', 'low'] as RiskLevel[]) {
      const fList = byRisk(level)
      if (fList.length === 0) continue
      lines.push(`### ${level.toUpperCase()} Risk`, '')
      fList.forEach((f) => {
        lines.push(`- **${f.key}** — ${f.type} (${f.location})`)
        lines.push(`  Value: \`${f.hint}\``)
        lines.push(`  Suggestion: ${f.suggestion}`)
        lines.push('')
      })
    }
  }

  return lines.join('\n')
}
