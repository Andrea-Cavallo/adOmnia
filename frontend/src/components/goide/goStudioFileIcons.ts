import type { BrandIconSlug } from '@/lib/brandIcons.generated'

/** Come mostrare l'icona di un file: logo di un marchio, gopher Go o icona generica. */
export type GoStudioFileIconKind =
  | { kind: 'gopher'; test: boolean }
  /** go.mod / go.work con il logo Go; go.sum (generato) attenuato. */
  | { kind: 'goModule'; generated: boolean }
  | { kind: 'brand'; slug: BrandIconSlug }
  /** Jenkinsfile: l'emblema Jenkins (Simple Icons non è incluso nel set generato). */
  | { kind: 'jenkins' }
  | { kind: 'generic'; icon: 'text' | 'pdf' | 'image' | 'archive' | 'lock' | 'license' | 'readme' | 'code' | 'key' | 'sql' | 'terminal' | 'schema' | 'file' }

const EXACT_NAMES: Record<string, BrandIconSlug> = {
  dockerfile: 'docker', '.dockerignore': 'docker', 'compose.yaml': 'docker', 'compose.yml': 'docker',
  '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', '.gitkeep': 'git', '.mailmap': 'git',
  makefile: 'make', gnumakefile: 'make',
  'package.json': 'npm', 'package-lock.json': 'npm', '.npmrc': 'npm',
  '.editorconfig': 'editorconfig', '.prettierrc': 'prettier', '.prettierignore': 'prettier',
  '.eslintrc': 'eslint', 'eslint.config.js': 'eslint', 'eslint.config.mjs': 'eslint',
  'chart.yaml': 'helm', 'values.yaml': 'helm', 'nginx.conf': 'nginx',
  'renovate.json': 'renovate', 'dependabot.yml': 'dependabot', 'dependabot.yaml': 'dependabot',
  'prometheus.yml': 'prometheus', 'prometheus.yaml': 'prometheus',
  '.gitlab-ci.yml': 'gitlab', 'codeowners': 'github',
}

const EXTENSIONS: Record<string, BrandIconSlug> = {
  md: 'markdown', markdown: 'markdown', yaml: 'yaml', yml: 'yaml', json: 'json', jsonc: 'json',
  xml: 'xml', toml: 'toml', html: 'html5', htm: 'html5', css: 'css', graphql: 'graphql', gql: 'graphql',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rs: 'rust', sh: 'gnubash', bash: 'gnubash', mk: 'make', tf: 'terraform', tfvars: 'terraform',
  sqlite: 'sqlite', db: 'sqlite', dockerfile: 'docker',
}

const GENERIC_EXTENSIONS: Record<string, Extract<GoStudioFileIconKind, { kind: 'generic' }>['icon']> = {
  txt: 'text', log: 'text', csv: 'text', pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image',
  zip: 'archive', gz: 'archive', tgz: 'archive', tar: 'archive', '7z': 'archive',
  lock: 'lock', pem: 'key', key: 'key', p12: 'key', pfx: 'key', jks: 'key', s: 'code', proto: 'schema', sql: 'sql', ps1: 'terminal', psm1: 'terminal', bat: 'terminal', cmd: 'terminal', mod: 'code', tmpl: 'code', gotmpl: 'code',
}

const KUBERNETES_KINDS = /^(deployment|service|ingress|configmap|secret|statefulset|daemonset|cronjob|job|pod|namespace|serviceaccount|role|rolebinding|clusterrole|clusterrolebinding|hpa|pvc|networkpolicy|kustomization)s?([.-][\w.-]+)?\.ya?ml$/
const KUBERNETES_DIRS = /(^|\/)(k8s|kubernetes|manifests|kustomize|deploy\/k8s)\//

/** Manifest Kubernetes riconosciuti da nome o cartella (il contenuto non si legge solo per un'icona). */
function isKubernetesManifest(lower: string, path: string): boolean {
  if (!/\.ya?ml$/.test(lower)) return false
  return KUBERNETES_KINDS.test(lower) || KUBERNETES_DIRS.test(path)
}

/**
 * Sceglie l'icona di un file: prima i nomi speciali (go.mod, Dockerfile, .gitignore…), poi i
 * percorsi con un significato (workflow GitHub, compose), poi l'estensione, infine un'icona
 * generica. I marchi valgono solo per ciò che ha davvero un'identità (Simple Icons); le estensioni
 * senza marchio usano icone generiche, mai loghi inventati.
 */
export function resolveGoStudioFileIcon(name: string, relativePath = ''): GoStudioFileIconKind {
  const lower = name.toLowerCase()
  const path = relativePath.replace(/\\/g, '/').toLowerCase()
  if (lower.endsWith('.go')) return { kind: 'gopher', test: lower.endsWith('_test.go') }
  if (lower === 'go.mod' || lower === 'go.work') return { kind: 'goModule', generated: false }
  if (lower === 'go.sum' || lower === 'go.work.sum') return { kind: 'goModule', generated: true }
  if (lower === 'jenkinsfile' || lower.startsWith('jenkinsfile.') || lower.endsWith('.jenkinsfile')) return { kind: 'jenkins' }
  if (path.startsWith('.github/workflows/') && /\.ya?ml$/.test(lower)) return { kind: 'brand', slug: 'githubactions' }
  if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(lower) || lower.endsWith('.dockerfile') || lower.startsWith('dockerfile.')) return { kind: 'brand', slug: 'docker' }
  if (isKubernetesManifest(lower, path)) return { kind: 'brand', slug: 'kubernetes' }
  if (/^(openapi|swagger)(\.[\w-]+)?\.(ya?ml|json)$/.test(lower)) return { kind: 'brand', slug: 'openapiinitiative' }
  if (lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.env')) return { kind: 'brand', slug: 'dotenv' }
  const exact = EXACT_NAMES[lower]
  if (exact) return { kind: 'brand', slug: exact }
  if (/^(license|licence|copying)(\.|$)/.test(lower)) return { kind: 'generic', icon: 'license' }
  if (/^readme(\.|$)/.test(lower) && !lower.endsWith('.md')) return { kind: 'generic', icon: 'readme' }
  const dot = lower.lastIndexOf('.')
  const extension = dot > 0 ? lower.slice(dot + 1) : ''
  const byExtension = EXTENSIONS[extension]
  if (byExtension) return { kind: 'brand', slug: byExtension }
  return { kind: 'generic', icon: GENERIC_EXTENSIONS[extension] ?? 'file' }
}

/** Icona di una cartella con un'identità precisa (.github, .git), altrimenti null. */
export function resolveGoStudioFolderBrand(name: string): BrandIconSlug | null {
  const lower = name.toLowerCase()
  if (lower === '.github') return 'github'
  if (lower === '.git') return 'git'
  if (lower === '.gitlab') return 'gitlab'
  return null
}

function relativeLuminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** Rapporto di contrasto WCAG fra due colori esadecimali senza #. */
export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/** Superfici dei temi scuro e chiaro (globals.css, --color-surface-0). */
const DARK_SURFACE = '05070D'
const LIGHT_SURFACE = 'F8FAFC'
/** Soglia WCAG per elementi grafici non testuali. */
const MIN_ICON_CONTRAST = 3

/**
 * Colore del marchio per tema: il colore ufficiale quando si legge, altrimenti il colore del testo
 * (currentColor). GitHub, Markdown o JSON sono neri e sparirebbero sul tema scuro; EditorConfig è
 * quasi bianco e sparirebbe su quello chiaro.
 */
export function brandColors(hex: string): { onDark: string; onLight: string } {
  return {
    onDark: contrastRatio(hex, DARK_SURFACE) >= MIN_ICON_CONTRAST ? `#${hex}` : 'currentColor',
    onLight: contrastRatio(hex, LIGHT_SURFACE) >= MIN_ICON_CONTRAST ? `#${hex}` : 'currentColor',
  }
}
