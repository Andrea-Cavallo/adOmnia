/**
 * ▶ nel gutter di Makefile e Dockerfile: target make, stage Docker, porte EXPOSE e
 * ARG dichiarati. Solo lettura del testo: l'esecuzione resta al backend.
 */
import { GoIDERunConfigurationKind, type GoIDERunConfiguration, type GoIDERunRequest } from '@/lib/goide-api'
import type { GoIDEQuickRunKind } from '@/stores/goide'

export type GoStudioToolFileKind = 'make' | 'docker'

export interface GoStudioToolTarget {
  line: number
  kind: GoStudioToolFileKind
  /** Target make, oppure nome dello stage Docker ('' = build completa). */
  name: string
  /** Cartella del file relativa al progetto ('' = radice): diventa la working directory. */
  directory: string
  /** Nome del file (Makefile, Dockerfile.dev…), relativo a directory. */
  file: string
  /** Solo Docker: porte EXPOSE del file, già nel formato host:container. */
  ports?: string[]
  /** Solo Docker: ARG dichiarati, con i nomi sensibili già marcati come segreti. */
  buildArgs?: Array<{ key: string; value: string; secret: boolean }>
}

const MAKE_TARGET = /^([A-Za-z0-9_][A-Za-z0-9_.\-/]*)(?:\s+[A-Za-z0-9_.\-/]+)*\s*::?(?!=)/
const DOCKER_FROM = /^\s*FROM\s+(?:--\S+\s+)*\S+(?:\s+AS\s+([A-Za-z0-9][A-Za-z0-9._-]*))?\s*$/i
const DOCKER_EXPOSE = /^\s*EXPOSE\s+(.+)$/i
const DOCKER_ARG = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(\S*))?/i
const SENSITIVE_NAME = /pass|secret|token|key|credential|pwd/i

export function toolFileKind(relativePath: string): GoStudioToolFileKind | null {
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1).toLowerCase()
  if (base === 'makefile' || base === 'gnumakefile' || base.endsWith('.mk')) return 'make'
  if (base === 'dockerfile' || base === 'containerfile' || base.startsWith('dockerfile.') || base.endsWith('.dockerfile')) return 'docker'
  return null
}

export function findToolTargets(relativePath: string, text: string): GoStudioToolTarget[] {
  const kind = toolFileKind(relativePath)
  if (!kind) return []
  const slash = relativePath.lastIndexOf('/')
  const directory = slash < 0 ? '' : relativePath.slice(0, slash)
  const file = relativePath.slice(slash + 1)
  const lines = text.split(/\r?\n/)
  return kind === 'make' ? makeTargets(lines, directory, file) : dockerTargets(lines, directory, file)
}

function makeTargets(lines: string[], directory: string, file: string): GoStudioToolTarget[] {
  const targets: GoStudioToolTarget[] = []
  const seen = new Set<string>()
  let inDefine = false
  lines.forEach((line, index) => {
    if (/^\s*define\b/.test(line)) inDefine = true
    if (inDefine) {
      if (/^\s*endef\b/.test(line)) inDefine = false
      return
    }
    const match = MAKE_TARGET.exec(line)
    if (!match || seen.has(match[1])) return
    seen.add(match[1])
    targets.push({ line: index + 1, kind: 'make', name: match[1], directory, file })
  })
  return targets
}

function dockerTargets(lines: string[], directory: string, file: string): GoStudioToolTarget[] {
  const ports: string[] = []
  const buildArgs: NonNullable<GoStudioToolTarget['buildArgs']> = []
  const froms: Array<{ line: number; stage: string }> = []
  lines.forEach((line, index) => {
    const from = DOCKER_FROM.exec(line)
    if (from) froms.push({ line: index + 1, stage: from[1] ?? '' })
    const expose = DOCKER_EXPOSE.exec(line)
    if (expose) {
      for (const port of expose[1].split(/\s+/)) {
        const [number, protocol] = port.split('/')
        if (/^\d{1,5}$/.test(number)) ports.push(`${number}:${number}${protocol ? `/${protocol}` : ''}`)
      }
    }
    const arg = DOCKER_ARG.exec(line)
    if (arg && !buildArgs.some((entry) => entry.key === arg[1])) {
      const secret = SENSITIVE_NAME.test(arg[1])
      buildArgs.push({ key: arg[1], value: secret ? '' : arg[2] ?? '', secret })
    }
  })
  // L'ultimo FROM è la build completa; uno stage intermedio senza nome non è costruibile da solo.
  return froms
    .map((from, index) => ({ ...from, stage: index === froms.length - 1 ? '' : from.stage }))
    .filter((from, index) => index === froms.length - 1 || from.stage !== '')
    .map((from) => ({ line: from.line, kind: 'docker' as const, name: from.stage, directory, file, ports: [...new Set(ports)], buildArgs }))
}

/** Etichetta leggibile del ▶: `make build`, `docker build --target builder`. */
export function toolTargetLabel(target: GoStudioToolTarget): string {
  if (target.kind === 'make') return `make ${target.name}`
  return target.name ? `docker build --target ${target.name}` : `docker build ${target.file}`
}

export type GoStudioToolAction = 'run' | 'build' | 'buildRun'

/** Richiesta immediata del ▶: senza build arg (valgono i default degli ARG), porte EXPOSE pubblicate per Build & Run. */
export function toolRunRequest(target: GoStudioToolTarget, action: GoStudioToolAction): { kind: GoIDEQuickRunKind; partial: Partial<GoIDERunRequest> } {
  const base = { workingDirectory: target.directory, target: target.file }
  if (target.kind === 'make') return { kind: 'make', partial: { ...base, programArguments: [target.name] } }
  const run = action === 'buildRun'
  return {
    kind: run ? 'docker-run' : 'docker-build',
    partial: { ...base, docker: { stage: target.name, ports: run ? target.ports ?? [] : [] } },
  }
}

/** Bozza di configurazione salvabile, con ARG del Dockerfile già elencati (sensibili come segreti). */
export function toolConfigurationDraft(target: GoStudioToolTarget, sessionId: string): GoIDERunConfiguration {
  const docker = target.kind === 'docker'
  const service = docker && (target.ports?.length ?? 0) > 0
  return {
    id: '', sessionId, order: 0, createdAt: '', updatedAt: '',
    name: docker ? `Docker ${target.name || target.file}` : `make ${target.name}`,
    kind: !docker ? GoIDERunConfigurationKind.RunKindMake : service ? GoIDERunConfigurationKind.RunKindDockerRun : GoIDERunConfigurationKind.RunKindDockerBuild,
    target: target.file, workingDirectory: target.directory,
    files: [], binaryPath: '', goArguments: [], buildTags: [], environment: [],
    programArguments: docker ? [] : [target.name],
    docker: docker ? { stage: target.name, ports: service ? target.ports : [], buildArgs: target.buildArgs ?? [] } : {},
  } as GoIDERunConfiguration
}

export function isToolTarget(target: { kind: string }): target is GoStudioToolTarget {
  return target.kind === 'make' || target.kind === 'docker'
}
