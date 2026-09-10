// Parsing stack traces into frames that can be opened in a repository.
//
// Four runtimes cover almost every enterprise log we see: Java/JVM, Go,
// Node/browser JS and Python. Each writes frames differently, and each mixes
// application code with framework and runtime frames — the ones nobody wants
// to open. Frames keep the original line so an unresolvable frame can still be
// copied verbatim.

export type StackLanguage = 'java' | 'go' | 'javascript' | 'python' | 'unknown'
export type FrameOrigin = 'application' | 'framework'

export interface StackFrame {
  /** Index inside the whole trace, used as a stable React key. */
  index: number
  language: StackLanguage
  origin: FrameOrigin
  /** Why the frame was classified as framework, empty for application frames. */
  originReason: string
  function: string
  /** File as written in the trace (`Orders.java`, `/build/app/main.go`, ...). */
  file: string
  /** Package/directory hint used to disambiguate a bare file name. */
  packagePath: string
  line: number
  raw: string
}

export interface StackSection {
  /** `Caused by: ...`, `Suppressed: ...` or the head of the trace. */
  title: string
  frames: StackFrame[]
  /** `... 12 more` — frames the runtime folded away. */
  elided: number
}

export interface ParsedStack {
  language: StackLanguage
  sections: StackSection[]
  frameCount: number
}

const FRAMEWORK_PACKAGES = [
  'java.', 'javax.', 'jakarta.', 'sun.', 'com.sun.', 'jdk.',
  'org.springframework.', 'org.apache.', 'org.hibernate.', 'ch.qos.', 'io.netty.',
  'org.junit.', 'org.eclipse.', 'io.micrometer.', 'reactor.', 'kotlin.', 'scala.',
]

const FRAMEWORK_PATHS = [
  { needle: '/go/pkg/mod/', reason: 'Go module cache' },
  { needle: '/usr/local/go/src/', reason: 'Go standard library' },
  { needle: '/vendor/', reason: 'vendored dependency' },
  { needle: 'node_modules', reason: 'npm dependency' },
  { needle: 'node:internal', reason: 'Node internals' },
  { needle: 'site-packages', reason: 'Python dependency' },
  { needle: 'dist-packages', reason: 'Python dependency' },
]

function classify(language: StackLanguage, fn: string, file: string): { origin: FrameOrigin; reason: string } {
  const path = file.replace(/\\/g, '/')
  const hit = FRAMEWORK_PATHS.find((candidate) => path.includes(candidate.needle))
  if (hit) return { origin: 'framework', reason: hit.reason }
  if (language === 'java') {
    const pkg = FRAMEWORK_PACKAGES.find((prefix) => fn.startsWith(prefix))
    if (pkg) return { origin: 'framework', reason: `${pkg}* package` }
  }
  if (language === 'go' && /^(?:runtime|reflect|net\/http|internal)\./.test(fn)) {
    return { origin: 'framework', reason: 'Go runtime' }
  }
  return { origin: 'application', reason: '' }
}

/** `com.acme.orders.Handler.create` + `Handler.java` → `com/acme/orders`. */
function javaPackagePath(qualified: string): string {
  const parts = qualified.split('.')
  // Drop the method and the class; what remains is the package.
  if (parts.length < 3) return ''
  return parts.slice(0, -2).join('/')
}

// Java 9+ prefixes the class with its module (`java.base/java.lang.Thread`);
// the module is dropped so the package prefixes below still match.
const JAVA_FRAME = /^\s*at\s+(?:[\w$.]+@?[\w$.-]*\/)?([\w$.<>]+)\((?:([\w$.]+\.\w+):(\d+)|([^)]*))\)\s*$/
const JAVA_ELIDED = /^\s*\.\.\.\s+(\d+)\s+more\s*$/
const JAVA_SECTION = /^(Caused by:|Suppressed:)\s*(.*)$/
const GO_LOCATION = /^\s+(.+?\.go):(\d+)(?:\s+\+0x[0-9a-f]+)?\s*$/
const GO_FUNCTION = /^([\w./\-()*]+\.[\w.()*]+)\(.*\)$/
const JS_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/
const PY_FRAME = /^\s*File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?\s*$/

export function detectStackLanguage(stack: string): StackLanguage {
  if (/^\s*at\s+(?:[\w$.]+@?[\w$.-]*\/)?[\w$.]+\([\w$.]+\.java:\d+\)/m.test(stack)) return 'java'
  if (/^\s*File\s+".+",\s+line\s+\d+/m.test(stack)) return 'python'
  if (/\.go:\d+/.test(stack) || /^goroutine\s+\d+/m.test(stack)) return 'go'
  if (/\s+at\s+.+:\d+:\d+/.test(stack)) return 'javascript'
  if (/^\s*at\s+[\w$.]+\(/m.test(stack)) return 'java'
  return 'unknown'
}

/** Parse a stack trace, keeping `Caused by` chains as separate sections. */
export function parseStackTrace(stack: string): ParsedStack {
  const language = detectStackLanguage(stack)
  const lines = stack.split('\n')
  const sections: StackSection[] = [{ title: lines[0]?.trim() || 'Stack trace', frames: [], elided: 0 }]
  let index = 0

  const push = (fn: string, file: string, packagePath: string, line: number, raw: string) => {
    const { origin, reason } = classify(language, fn, file)
    sections[sections.length - 1].frames.push({
      index: index++, language, origin, originReason: reason, function: fn, file, packagePath, line, raw,
    })
  }

  for (let cursor = language === 'go' ? 0 : 1; cursor < lines.length; cursor++) {
    const raw = lines[cursor]
    if (!raw.trim()) continue

    const section = JAVA_SECTION.exec(raw.trim())
    if (section) {
      sections.push({ title: raw.trim(), frames: [], elided: 0 })
      continue
    }
    const elided = JAVA_ELIDED.exec(raw)
    if (elided) {
      sections[sections.length - 1].elided += Number(elided[1])
      continue
    }

    if (language === 'go') {
      const location = GO_LOCATION.exec(raw)
      if (location) {
        const previous = GO_FUNCTION.exec(lines[cursor - 1]?.trim() ?? '')
        push(previous?.[1] ?? '', location[1], '', Number(location[2]), raw.trim())
      }
      continue
    }

    const java = JAVA_FRAME.exec(raw)
    if (java && java[2]) {
      push(java[1], java[2], javaPackagePath(java[1]), Number(java[3]), raw.trim())
      continue
    }
    if (java) continue // Native Method / Unknown Source: no location to open.

    const python = PY_FRAME.exec(raw)
    if (python) {
      push(python[3] ?? '', python[1], '', Number(python[2]), raw.trim())
      continue
    }

    const js = JS_FRAME.exec(raw)
    if (js) {
      push(js[1] ?? '', js[2], '', Number(js[3]), raw.trim())
    }
  }

  return { language, sections, frameCount: index }
}

/**
 * Repository-relative candidates for one frame, longest first: a build-machine
 * absolute path rarely exists locally, but its tail usually does.
 */
export function frameCandidates(frame: StackFrame): string[] {
  const normalized = frame.file.replace(/\\/g, '/')
  if (frame.packagePath) {
    const name = normalized.split('/').pop() || normalized
    return [`${frame.packagePath}/${name}`, name]
  }
  const parts = normalized.replace(/^\//, '').split('/').filter(Boolean)
  const candidates: string[] = []
  for (let start = 0; start < parts.length; start++) {
    candidates.push(parts.slice(start).join('/'))
  }
  return candidates
}
