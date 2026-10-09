// Reproduction Studio: turns one observed request run into files a teammate (or CI) can replay:
// README with steps, an .http fixture, a Go regression test, the SQL, Kafka fixtures, an env
// template, logs and stacks. Secrets are stripped; non-deterministic values are listed.
import type { LiveLogEntry, LiveMessage, LiveQuery, RequestRun } from '@/lib/devsession-api'
import type { OtlpSpan } from '@/lib/otlp-api'
import type { KVRow, RequestBody } from '@/lib/types'
import { FIXTURE_FORMAT } from '@/lib/kafkaFixture'

export interface ReproRequest {
  method: string
  /** URL as written in the request, {{variables}} included. */
  url: string
  headers: KVRow[]
  body?: RequestBody
}

export interface ReproInput {
  run: RequestRun
  request: ReproRequest
  service: string
  logs: LiveLogEntry[]
  queries: LiveQuery[]
  messages: LiveMessage[]
  /** OpenTelemetry spans of the request's trace, when the services export them locally. */
  spans?: OtlpSpan[]
  /** ISO timestamp used for the folder name. */
  createdAt: string
}

export interface ReproFile {
  relativePath: string
  content: string
}

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token)$/i
const SECRET_KEY = /(pass(word|wd)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i
const VARIABLE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/g
const DYNAMIC_VAR = /\{\{\s*\$[\w.]+\s*\}\}/g
const SQL_CLOCK = /\b(NOW\(\)|CURRENT_TIMESTAMP|CURRENT_DATE|RANDOM\(\)|RAND\(\)|UUID\(\)|GEN_RANDOM_UUID\(\)|NEWID\(\))/gi

export function slug(text: string): string {
  return text.toLowerCase().replace(/\{\{[^}]*\}\}/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'request'
}

function placeholder(header: string): string {
  return header.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Secret header values become {{PLACEHOLDER}} variables, so the fixture still runs with an env file. */
export function stripHeaders(headers: KVRow[]): Array<{ key: string; value: string; secret: boolean }> {
  return headers
    .filter((header) => header.enabled && header.key)
    .map((header) => (SECRET_HEADER.test(header.key) && !/^\s*\{\{[^}]+\}\}\s*$/.test(header.value)
      ? { key: header.key, value: `{{${placeholder(header.key)}}}`, secret: true }
      : { key: header.key, value: header.value, secret: false }))
}

/** JSON bodies lose the values of secret-looking keys; other text is kept as typed. */
export function stripBody(raw: string): string {
  try {
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(walk)
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) && typeof item !== 'object' ? '<redacted>' : walk(item)]))
      }
      return value
    }
    return JSON.stringify(walk(JSON.parse(raw)), null, 2)
  } catch {
    return raw.replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)("[^"]*"|[^&\s]+)/gi, '$1<redacted>')
  }
}

/** Log lines with bearer tokens or key=value secrets masked. */
export function stripText(text: string): string {
  return text
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1<redacted>')
    .replace(/((?:password|passwd|secret|token|api[_-]?key)"?\s*[=:]\s*"?)([^"\s,&]+)/gi, '$1<redacted>')
}

export function variablesIn(...texts: string[]): string[] {
  const names = new Set<string>()
  for (const text of texts) for (const match of text.matchAll(VARIABLE)) names.add(match[1])
  return [...names].sort()
}

/** Values that will differ on every replay: ids, timestamps, generated variables, clock/random SQL. */
export function nonDeterministic(texts: string[], sql: string[]): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    for (const match of text.matchAll(UUID)) found.add(`UUID ${match[0]}`)
    for (const match of text.matchAll(ISO_TIME)) found.add(`timestamp ${match[0]}`)
    for (const match of text.matchAll(DYNAMIC_VAR)) found.add(`generated value ${match[0]}`)
  }
  for (const statement of sql) for (const match of statement.matchAll(SQL_CLOCK)) found.add(`SQL ${match[1].toUpperCase()}`)
  return [...found]
}

function bodyText(body: RequestBody | undefined): string {
  if (!body || body.type === 'none') return ''
  if (body.type === 'urlencoded' || body.type === 'formdata') return body.form.filter((row) => row.enabled && row.key).map((row) => `${row.key}=${row.value}`).join('&')
  return body.raw
}

function goString(text: string): string {
  return '`' + text.replace(/`/g, '` + "`" + `') + '`'
}

function goTest(name: string, method: string, path: string, headers: Array<{ key: string; value: string }>, body: string, observed: number | undefined): string {
  const fn = name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
  const headerLines = headers.map((header) => `	req.Header.Set(${JSON.stringify(header.key)}, expand(${JSON.stringify(header.value)}))`)
  return `package repro

import (
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
)

// {{name}} placeholders come from the environment (see .env.example).
var placeholder = regexp.MustCompile(\`\\{\\{\\s*([A-Za-z_][\\w.-]*)\\s*\\}\\}\`)

func expand(text string) string {
	return placeholder.ReplaceAllStringFunc(text, func(match string) string {
		return os.Getenv(placeholder.FindStringSubmatch(match)[1])
	})
}

// TestReproduce${fn} replays the request captured by adOmnia. It was observed returning
// ${observed ?? 'no response'}; once the bug is fixed it should answer below 400.
// Run it against a running service: BASE_URL=http://localhost:8080 go test ./...
func TestReproduce${fn}(t *testing.T) {
	base := os.Getenv("BASE_URL")
	if base == "" {
		t.Skip("set BASE_URL to the running service")
	}
	req, err := http.NewRequest(${JSON.stringify(method)}, strings.TrimRight(base, "/")+expand(${JSON.stringify(path)}), strings.NewReader(expand(${goString(body)})))
	if err != nil {
		t.Fatal(err)
	}
${headerLines.join('\n')}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		t.Fatalf("still reproduces: %s", res.Status)
	}
}
`
}

function pathOf(url: string): string {
  const withoutBase = url.replace(/^\s*(\{\{[^}]+\}\}|[a-z]+:\/\/[^/]+)/i, '')
  return withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`
}

export function buildReproduction(input: ReproInput): { dir: string; files: ReproFile[]; secretsStripped: number; nonDeterministic: string[] } {
  const { run, request } = input
  const name = slug(`${run.method} ${pathOf(request.url)}`)
  const stamp = input.createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$|Z$/, '').replace('T', '-').slice(0, 15)
  const dir = `repro/${stamp}-${name}`
  const headers = stripHeaders(request.headers)
  const rawBody = bodyText(request.body)
  const body = rawBody ? stripBody(rawBody) : ''
  const secretsStripped = headers.filter((header) => header.secret).length + (body !== rawBody && rawBody ? 1 : 0)
  const env = variablesIn(request.url, ...headers.map((header) => header.value), body)
  const sql = input.queries.map((query) => query.sql)
  const flaky = nonDeterministic([request.url, rawBody, ...headers.map((header) => header.value)], sql)
  const files: ReproFile[] = []
  const add = (file: string, content: string) => files.push({ relativePath: `${dir}/${file}`, content })

  const http = [`### ${run.name || `${run.method} ${pathOf(request.url)}`}`, `${run.method} ${request.url}`, ...headers.map((header) => `${header.key}: ${header.value}`)]
  add('request.http', `${http.join('\n')}\n${body ? `\n${body}\n` : ''}`)
  add('repro_test.go', goTest(name, run.method, pathOf(request.url), headers, body, run.status))
  add('.env.example', `# Values the request needs (the captured ones are not written here)\nBASE_URL=\n${env.map((key) => `${key}=`).join('\n')}${env.length ? '\n' : ''}`)
  if (input.queries.length) {
    add('queries.sql', input.queries.map((query) => `-- ${query.at}${query.datasource ? ` · ${query.datasource}` : ''}${query.error ? ` · ERROR ${query.error}` : ''}\n${stripText(query.sql.trim())};\n`).join('\n'))
  }
  input.messages.forEach((message, index) => {
    add(`kafka/${String(index + 1).padStart(2, '0')}-${slug(message.topic)}.kafka.json`, `${JSON.stringify({
      format: FIXTURE_FORMAT, version: 1, topic: message.topic, key: message.key ?? '', headers: message.headers ?? {},
      value: stripText(message.preview ?? ''), source: { partition: message.partition, offset: message.offset, timestamp: message.at },
    }, null, 2)}\n`)
  })
  if (input.logs.length) add('logs.txt', `${input.logs.map((entry) => `${entry.at} ${entry.stream}${entry.level ? ` ${entry.level}` : ''} ${stripText(entry.text)}`).join('\n')}\n`)
  if (input.spans?.length) {
    // Attribute values can hold secrets (URLs with tokens, auth headers): same stripping as the logs.
    const spans = input.spans.map((span) => ({ ...span, attributes: Object.fromEntries(Object.entries(span.attributes ?? {}).map(([key, value]) => [key, stripText(String(value))])) }))
    add('trace.json', `${JSON.stringify({ traceId: spans[0].traceId, spans }, null, 2)}
`)
  }
  if (run.hits.length) {
    add('stack.txt', `${run.hits.map((hit) => [`${hit.at} ${hit.function} ${hit.relativePath ?? hit.file ?? ''}:${hit.line}`, ...(hit.stack ?? []).map((frame) => `    ${frame.function} ${frame.relativePath ?? frame.file ?? ''}:${frame.line}`)].join('\n')).join('\n\n')}\n`)
  }

  const steps = [
    `Start ${input.service} with the configuration of \`.env.example\` (fill the values).`,
    ...(input.queries.length ? ['Bring the database to the state the statements in `queries.sql` expect.'] : []),
    ...(input.messages.length ? ['If the flow starts from a message, load the `kafka/*.kafka.json` fixtures in Broker Studio (Producer → Load fixture).'] : []),
    `Send \`request.http\` (adOmnia, VS Code REST Client or IntelliJ), or run \`BASE_URL=http://localhost:PORT go test ./${dir}/\`.`,
  ]
  const index = files.map((file) => `- \`${file.relativePath.slice(dir.length + 1)}\``).join('\n')
  add('README.md', `# Reproduction: ${run.method} ${pathOf(request.url)}

Captured by adOmnia on ${input.createdAt} from **${input.service}**.

| | |
| --- | --- |
| Outcome | ${run.status ? `HTTP ${run.status}` : run.error || run.state}${run.durationMs !== undefined ? ` in ${run.durationMs} ms` : ''} |
| Correlation id | \`${run.correlationId || '—'}\` |
| Logs · SQL · messages · breakpoint hits | ${input.logs.length} · ${input.queries.length} · ${input.messages.length} · ${run.hits.length} |

## Steps

${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

## Things that will differ on replay

${flaky.length ? flaky.map((item) => `- ${item}`).join('\n') : '- Nothing obvious: no ids, timestamps or generated values were found in the request.'}

## Secrets

${secretsStripped ? `${secretsStripped} secret value(s) were replaced by placeholders: set them in the environment, never in these files.` : 'No secret values were found in the request.'}

## Files

${index}
`)
  return { dir, files, secretsStripped, nonDeterministic: flaky }
}
