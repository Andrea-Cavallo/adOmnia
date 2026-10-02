/** Campi Go gestiti con un controllo dedicato; il resto dell'ambiente resta nell'area "Other variables". */
export const TOOLCHAIN_FIELDS = ['GOPROXY', 'GOPRIVATE', 'GONOSUMDB', 'GONOPROXY', 'CGO_ENABLED', 'GOOS', 'GOARCH'] as const
export type ToolchainField = typeof TOOLCHAIN_FIELDS[number]

export interface ToolchainForm {
  fields: Record<ToolchainField, string>
  buildTags: string
  /** GOFLAGS senza -tags, che è gestito da buildTags. */
  goflags: string
  other: string
}

const TAGS_FLAG = /(^|\s)-tags[= ](\S+)/

export function toolchainFormFromEnv(environment: Record<string, string | undefined> | undefined): ToolchainForm {
  const env = Object.fromEntries(Object.entries(environment ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const fields = Object.fromEntries(TOOLCHAIN_FIELDS.map((key) => [key, env[key] ?? ''])) as Record<ToolchainField, string>
  const flags = env.GOFLAGS ?? ''
  const tags = flags.match(TAGS_FLAG)?.[2] ?? ''
  const other = Object.entries(env)
    .filter(([key]) => !(TOOLCHAIN_FIELDS as readonly string[]).includes(key) && key !== 'GOFLAGS')
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  return { fields, buildTags: tags, goflags: flags.replace(TAGS_FLAG, ' ').trim(), other }
}

/** Ricompone l'ambiente: i campi vuoti non vengono impostati, così vale il default di `go env`. */
export function toolchainEnvFromForm(form: ToolchainForm): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of form.other.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) env[line.slice(0, separator).trim()] = line.slice(separator + 1)
  }
  for (const key of TOOLCHAIN_FIELDS) {
    const value = form.fields[key].trim()
    if (value) env[key] = value
  }
  const tags = form.buildTags.split(/[\s,]+/).filter(Boolean).join(',')
  const goflags = [form.goflags.trim(), tags ? `-tags=${tags}` : ''].filter(Boolean).join(' ')
  if (goflags) env.GOFLAGS = goflags
  return env
}

const PATTERN_FIELDS: ReadonlySet<ToolchainField> = new Set(['GOPRIVATE', 'GONOPROXY', 'GONOSUMDB'])

/**
 * GOPRIVATE, GONOPROXY e GONOSUMDB sono liste di glob di prefissi di module path separate da virgole:
 * niente schema, credenziali, spazi o voci vuote. null se il valore è valido o vuoto.
 */
export function modulePatternProblem(field: ToolchainField, value: string): string | null {
  if (!PATTERN_FIELDS.has(field) || !value.trim()) return null
  const patterns = value.split(',')
  if (patterns.some((pattern) => !pattern.trim())) return 'Remove the empty entry between commas.'
  for (const pattern of patterns.map((item) => item.trim())) {
    if (/\s/.test(pattern)) return `"${pattern}" contains spaces: separate patterns with commas.`
    if (pattern.includes('://')) return `"${pattern}" is a URL: use a module path prefix such as git.example.com/team/*.`
    if (pattern.includes('@')) return `"${pattern}" contains "@": credentials belong in .netrc or a Git credential helper, not here.`
    if (pattern.startsWith('/') || pattern.endsWith('/')) return `"${pattern}" must not start or end with "/".`
  }
  return null
}

const PUBLIC_HOSTS = new Set(['golang.org', 'google.golang.org', 'gopkg.in', 'go.uber.org', 'k8s.io', 'sigs.k8s.io', 'cloud.google.com'])
const HOSTED_FORGES = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'])

/**
 * Pattern GOPRIVATE suggerito dal module path del progetto: l'organizzazione sui forge pubblici
 * (github.com/acme/*), l'host intero per un server aziendale; null per moduli pubblici o locali.
 */
export function suggestedPrivatePattern(modulePath: string): string | null {
  const [host, owner] = modulePath.trim().split('/')
  if (!host?.includes('.') || PUBLIC_HOSTS.has(host)) return null
  if (HOSTED_FORGES.has(host)) return owner ? `${host}/${owner}/*` : null
  return host
}
