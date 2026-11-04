/** Un problema trovato in un MANIFEST.MF: la riga è 1-based, come nell'editor. */
export interface ManifestIssue {
  line: number
  /** 1-based colonna dove inizia il problema. */
  column: number
  severity: 'error' | 'warning'
  message: string
}

/**
 * Header che un manifest OSGi/JAR usa davvero. Non è una lista chiusa — il formato accetta header
 * propri — ma serve a riconoscere un refuso, che è l'errore che nessuno nota.
 */
const KNOWN_HEADERS = [
  'Manifest-Version', 'Created-By', 'Main-Class', 'Class-Path', 'Sealed', 'Name', 'Content-Type',
  'Implementation-Title', 'Implementation-Version', 'Implementation-Vendor', 'Implementation-URL',
  'Specification-Title', 'Specification-Version', 'Specification-Vendor',
  'Bundle-ManifestVersion', 'Bundle-Name', 'Bundle-SymbolicName', 'Bundle-Version', 'Bundle-Vendor',
  'Bundle-ClassPath', 'Bundle-Localization', 'Bundle-RequiredExecutionEnvironment',
  'Bundle-Activator', 'Bundle-ActivationPolicy', 'Bundle-Category', 'Bundle-Copyright',
  'Bundle-Description', 'Bundle-DocURL', 'Bundle-Icon', 'Bundle-License', 'Bundle-NativeCode',
  'Bundle-UpdateLocation', 'Bundle-ContactAddress',
  'Export-Package', 'Import-Package', 'Require-Bundle', 'Fragment-Host', 'DynamicImport-Package',
  'Provide-Capability', 'Require-Capability', 'Export-Service', 'Import-Service',
  'Service-Component', 'Eclipse-LazyStart', 'Eclipse-RegisterBuddy', 'Eclipse-BuddyPolicy',
  'Eclipse-PlatformFilter', 'Eclipse-ExtensibleAPI', 'Embed-Dependency', 'Private-Package',
]

const HEADER_LINE = /^([A-Za-z0-9][A-Za-z0-9_.-]*):(.*)$/
const VERSION = /^\d+(\.\d+){0,3}(\.[A-Za-z0-9_-]+)?$/
/** Il manifest va spezzato a 72 byte: oltre, alcuni lettori troncano il valore. */
const MAX_LINE_BYTES = 72

/**
 * Controlla un manifest come fa il Plug-in Manifest Editor di Eclipse per le cose che contano:
 * righe malformate, header duplicati o con un refuso, header OSGi obbligatori e versione non valida.
 * Non giudica i valori (un export può contenere qualsiasi pacchetto).
 */
export function manifestIssues(text: string): ManifestIssue[] {
  const issues: ManifestIssue[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const seen = new Map<string, number>()
  const mainHeaders = new Set<string>()
  let inMainSection = true

  lines.forEach((line, index) => {
    const number = index + 1
    if (line.trim() === '') {
      inMainSection = false
      return
    }
    if (line.startsWith(' ')) {
      // Riga di continuazione: appartiene all'header precedente.
      if (index === 0) issues.push(issue(number, 1, 'error', 'A manifest cannot start with a continuation line.'))
      return
    }
    const match = HEADER_LINE.exec(line)
    if (!match) {
      issues.push(issue(number, 1, 'error', `Expected "Name: value", found "${truncate(line)}".`))
      return
    }
    const name = match[1]
    const value = match[2].trim()
    if (value === '' && name !== 'Name') {
      issues.push(issue(number, 1, 'warning', `${name} has no value.`))
    }
    if (byteLength(line) > MAX_LINE_BYTES) {
      issues.push(issue(number, MAX_LINE_BYTES + 1, 'warning', `This line is longer than ${MAX_LINE_BYTES} bytes: wrap it with a leading space (as Eclipse and Maven do).`))
    }
    if (inMainSection) {
      mainHeaders.add(name)
      const duplicate = seen.get(name.toLowerCase())
      if (duplicate !== undefined) {
        issues.push(issue(number, 1, 'warning', `${name} is already declared on line ${duplicate}; the last value wins.`))
      } else {
        seen.set(name.toLowerCase(), number)
      }
    }
    const suggestion = closestHeader(name)
    if (suggestion) {
      issues.push(issue(number, 1, 'warning', `Unknown header ${name}; did you mean ${suggestion}?`))
    }
    if (name === 'Bundle-Version' && !VERSION.test(value)) {
      issues.push(issue(number, 1, 'warning', `"${truncate(value)}" is not a valid OSGi version (major.minor.micro.qualifier).`))
    }
  })

  if (mainHeaders.size === 0) {
    issues.push(issue(1, 1, 'warning', 'This manifest has no header.'))
  }
  if (!mainHeaders.has('Manifest-Version')) {
    issues.push(issue(1, 1, 'warning', 'Manifest-Version: 1.0 is missing.'))
  }
  // OSGi R4 headers come together: a bundle without Bundle-ManifestVersion is not a bundle for
  // Equinox, which then reports a resolution failure far from the cause.
  if (mainHeaders.has('Bundle-SymbolicName') && !mainHeaders.has('Bundle-ManifestVersion')) {
    issues.push(issue(1, 1, 'error', 'Bundle-ManifestVersion: 2 is missing: without it Equinox does not read this as a bundle.'))
  }
  return issues
}

function issue(line: number, column: number, severity: 'error' | 'warning', message: string): ManifestIssue {
  return { line, column, severity, message }
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Header noto più vicino, quando la distanza è un refuso e non un header nuovo. */
function closestHeader(name: string): string | null {
  const lower = name.toLowerCase()
  if (KNOWN_HEADERS.some((known) => known.toLowerCase() === lower)) return null
  // Un header con un punto può essere di un'altra specifica: solo i trattini sono refusi tipici.
  let best: string | null = null
  let bestDistance = 3
  for (const known of KNOWN_HEADERS) {
    const distance = editDistance(lower, known.toLowerCase())
    if (distance < bestDistance) {
      best = known
      bestDistance = distance
    }
  }
  return best
}

/** Distanza di Levenshtein, ferma a `limit` per non pagare il caso peggiore. */
function editDistance(left: string, right: string, limit = 3): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    let rowMinimum = current[0]
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      rowMinimum = Math.min(rowMinimum, current[j])
    }
    if (rowMinimum > limit) return limit + 1
    previous = current
  }
  return previous[right.length]
}
