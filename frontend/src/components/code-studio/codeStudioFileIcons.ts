import type { BrandIconSlug } from '@/lib/brandIcons.generated'
import { IDE_LANGUAGES } from '@/components/ide/languages'
import type { IdeFileIcon } from '@/lib/code-studio/fileIconTypes'

/** Come mostrare l'icona di un file: logo di un marchio, gopher Go o icona generica. */
export type CodeStudioFileIconKind = IdeFileIcon

const EXACT_NAMES: Record<string, BrandIconSlug> = {
  'claude.md': 'claude',
  dockerfile: 'docker', '.dockerignore': 'docker', 'compose.yaml': 'docker', 'compose.yml': 'docker',
  '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', '.gitkeep': 'git', '.mailmap': 'git',
  makefile: 'make', gnumakefile: 'make',
  '.editorconfig': 'editorconfig',
  'chart.yaml': 'helm', 'values.yaml': 'helm', 'nginx.conf': 'nginx',
  'renovate.json': 'renovate', 'dependabot.yml': 'dependabot', 'dependabot.yaml': 'dependabot',
  'prometheus.yml': 'prometheus', 'prometheus.yaml': 'prometheus',
  '.gitlab-ci.yml': 'gitlab', 'codeowners': 'github',
  'composer.json': 'php', gemfile: 'ruby', 'pubspec.yaml': 'dart', 'build.zig': 'zig', 'mix.exs': 'elixir', 'package.swift': 'swift',
}

const EXTENSIONS: Record<string, BrandIconSlug> = {
  md: 'markdown', markdown: 'markdown', yaml: 'yaml', yml: 'yaml',
  xml: 'xml', toml: 'toml', graphql: 'graphql', gql: 'graphql',
  sh: 'gnubash', bash: 'gnubash', mk: 'make', tf: 'terraform', tfvars: 'terraform',
  sqlite: 'sqlite', db: 'sqlite', dockerfile: 'docker',
  kt: 'kotlin', kts: 'kotlin', php: 'php', rb: 'ruby', cs: 'dotnet', csproj: 'dotnet', fs: 'dotnet', sln: 'dotnet',
  cpp: 'cplusplus', cc: 'cplusplus', cxx: 'cplusplus', hpp: 'cplusplus', c: 'c', h: 'c', swift: 'swift', dart: 'dart', scala: 'scala',
  ex: 'elixir', exs: 'elixir', hs: 'haskell', lua: 'lua', zig: 'zig',
}

const GENERIC_EXTENSIONS: Record<string, Extract<CodeStudioFileIconKind, { kind: 'generic' }>['icon']> = {
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
export function resolveCodeStudioFileIcon(name: string, relativePath = ''): CodeStudioFileIconKind {
  const lower = name.toLowerCase()
  const path = relativePath.replace(/\\/g, '/').toLowerCase()
  for (const language of IDE_LANGUAGES) {
    const contributed = language.fileIcon?.(lower)
    if (contributed) return contributed
  }
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

export { brandColors, contrastRatio } from '@/lib/brandColors'
