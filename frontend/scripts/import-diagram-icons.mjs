// Copies the icon sets of Diagram Studio into public/diagram-icons and writes the manifest the
// Icons tab reads (lazily, only when it opens). Icons are served as files, never bundled into the JS.
//
//   node scripts/import-diagram-icons.mjs --aws <folder containing aws-icons/> --tech <simple-icons checkout>
//
// Either option can be omitted: the set already in public/diagram-icons is then kept.
//   aws:  AWS Architecture Icons (PNG), grouped by AWS category and kind (service, resource, category).
//   tech: Simple Icons (SVG, CC0 project; trademarks belong to their owners), colored with the brand
//         color and grouped in developer categories (languages, databases, messaging…); the rest of
//         the brands stay searchable under "More brands".
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

const option = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const awsSource = option('--aws')
const techSource = option('--tech')
if (!awsSource && !techSource) {
  console.error('usage: node scripts/import-diagram-icons.mjs --aws <folder with aws-icons> --tech <simple-icons checkout>')
  process.exit(1)
}
const target = join(import.meta.dirname, '..', 'public', 'diagram-icons')
mkdirSync(target, { recursive: true })
const manifestPath = join(target, 'manifest.json')
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).icons : []
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ------------------------------------------------------------------ AWS

const AWS_KINDS = { 'Architecture-Service': 'service', Resource: 'resource', Category: 'category' }
const AWS_ALIASES = {
  'App Integration': 'Application Integration', 'VR AR': 'AR & VR', 'AR VR': 'AR & VR', 'Management Governance': 'Management & Governance',
  'Front End Web Mobile': 'Front-End Web & Mobile', 'End User Computing': 'End-User Computing', 'Networking Content Delivery': 'Networking & Content Delivery',
  'Migration Transfer': 'Migration & Transfer', 'Security Identity Compliance': 'Security, Identity & Compliance', 'Security Identity & Compliance': 'Security, Identity & Compliance',
  'Internet of Things': 'IoT', loT: 'IoT',
}
const awsCategory = (folder) => {
  const label = folder.replace(/-and-/g, ' & ').replace(/[_-]/g, ' ')
  return AWS_ALIASES[label] ?? AWS_ALIASES[folder] ?? label
}

function walk(dir, extension) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path, extension) : name.toLowerCase().endsWith(extension) ? [path] : []
  })
}

function importAws(source) {
  const root = join(source, 'aws-icons')
  rmSync(join(target, 'aws'), { recursive: true, force: true })
  return walk(root, '.png').flatMap((file) => {
    const parts = relative(root, file).split(sep)
    const kind = AWS_KINDS[parts[0]]
    if (!kind) return []
    const category = awsCategory(kind === 'category' ? basename(file, '.png') : parts[1])
    const path = ['aws', kind, slug(category), basename(file).replace(/[^A-Za-z0-9._-]/g, '-')].join('/')
    mkdirSync(join(target, ...path.split('/').slice(0, -1)), { recursive: true })
    copyFileSync(file, join(target, ...path.split('/')))
    return [{ s: 'aws', n: basename(file, '.png').replace(/_/g, ' · ').replace(/-/g, ' '), c: category, k: kind, p: path }]
  })
}

// ------------------------------------------------------------------ Tech (Simple Icons)

/** Developer categories, in display order; a brand appears in the first one that lists it. */
const TECH_CATEGORIES = [
  ['Languages', 'python go rust openjdk javascript typescript kotlin scala ruby php c cplusplus swift dart elixir erlang haskell clojure lua perl r julia zig nim ocaml fsharp gnubash solidity webassembly fortran cobol assemblyscript crystal gleam v elm purescript racket commonlisp coffeescript'],
  ['Runtimes & frameworks', 'nodedotjs deno bun dotnet spring springboot quarkus micronaut react angular vuedotjs svelte nextdotjs nuxt remix astro solid django flask fastapi express nestjs laravel symfony rubyonrails gin fiber echo hibernate apachetomcat jakartaee vertdotx ktor flutter reactnative electron tauri wails htmx tailwindcss bootstrap'],
  ['Databases', 'postgresql mysql mariadb mongodb redis sqlite apachecassandra neo4j elasticsearch opensearch clickhouse cockroachlabs influxdb timescale supabase firebase snowflake duckdb couchbase scylladb surrealdb prisma apachehbase apachehive apachedruid questdb arangodb dragonfly memcached h2database liquibase flyway'],
  ['Messaging & streaming', 'apachekafka rabbitmq apachepulsar natsdotio mqtt apacheflink apachespark apacheairflow apachenifi eclipsemosquitto amazonsqs googlepubsub temporal celery debezium'],
  ['Cloud & hosting', 'googlecloud amazonwebservices cloudflare digitalocean vercel netlify alibabacloud hetzner ovh akamai linode render railway flydotio scaleway vultr backblaze minio'],
  ['Containers & infrastructure', 'docker kubernetes helm podman containerd terraform opentofu ansible pulumi packer vagrant nginx apache traefikproxy envoyproxy istio linkerd consul vault nomad redhatopenshift rancher argo k3s portainer caddy haproxy'],
  ['Operating systems', 'linux ubuntu debian redhat fedora alpinelinux archlinux centos rockylinux almalinux macos apple android ios freebsd'],
  ['CI/CD & dev tools', 'git github gitlab bitbucket gitea jenkins githubactions circleci travisci azuredevops argocd sonar jira confluence trello postman insomnia swagger openapiinitiative graphql json yaml toml markdown apachemaven gradle npm pnpm yarn webpack vite babel esbuild intellijidea eclipseide neovim vim jetbrains junit5 jest vitest cypress selenium pytest mockito'],
  ['Observability', 'prometheus grafana elastic kibana logstash fluentd fluentbit opentelemetry jaeger datadog newrelic sentry splunk dynatrace pagerduty victoriametrics zipkin'],
  ['Security & identity', 'auth0 okta keycloak letsencrypt openid jsonwebtokens owasp snyk trivy openssl wireguard openvpn 1password bitwarden hashicorp'],
  ['AI & data science', 'anthropic claude huggingface tensorflow pytorch ollama langchain jupyter numpy pandas scikitlearn keras mlflow kaggle googlegemini mistralai'],
]

const SLUG_REPLACEMENTS = { '+': 'plus', '.': 'dot', '&': 'and', đ: 'd', ħ: 'h', ı: 'i', ĸ: 'k', ŀ: 'l', ł: 'l', ß: 'ss', ŧ: 't', ø: 'o' }
/** Simple Icons' file name for a title (its own rule, so their code is never executed here). */
const iconSlug = (icon) => icon.slug ?? icon.title.toLowerCase()
  .replace(/[+.&đħıĸŀłßŧø]/g, (char) => SLUG_REPLACEMENTS[char])
  .normalize('NFD').replace(/[^a-z\d]/g, '')

/** The brand color, unless it is too dark or too light to read on both themes: then a neutral grey. */
function displayColor(hex) {
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance < 0.035 || luminance > 0.85 ? '#8a8f98' : `#${hex}`
}

function importTech(source) {
  const data = JSON.parse(readFileSync(join(source, 'data', 'simple-icons.json'), 'utf8'))
  const categoryOf = new Map()
  for (const [category, slugs] of TECH_CATEGORIES) for (const name of slugs.split(' ')) if (!categoryOf.has(name)) categoryOf.set(name, category)
  rmSync(join(target, 'tech'), { recursive: true, force: true })
  mkdirSync(join(target, 'tech'), { recursive: true })
  const icons = []
  for (const icon of data) {
    const name = iconSlug(icon)
    const file = join(source, 'icons', `${name}.svg`)
    if (!existsSync(file)) continue
    const svg = readFileSync(file, 'utf8').replace('<svg ', `<svg fill="${displayColor(icon.hex)}" `)
    writeFileSync(join(target, 'tech', `${name}.svg`), svg)
    const aka = icon.aliases?.aka?.join(' ') ?? ''
    icons.push({ s: 'tech', n: icon.title, c: categoryOf.get(name) ?? 'More brands', k: 'brand', p: `tech/${name}.svg`, ...(aka ? { a: aka } : {}) })
  }
  const missing = [...categoryOf.keys()].filter((name) => !existsSync(join(source, 'icons', `${name}.svg`)))
  if (missing.length) console.warn(`not in this Simple Icons version (skipped): ${missing.join(' ')}`)
  return icons
}

const aws = awsSource ? importAws(awsSource) : previous.filter((icon) => (icon.s ?? 'aws') === 'aws').map((icon) => ({ s: 'aws', ...icon }))
const tech = techSource ? importTech(techSource) : previous.filter((icon) => icon.s === 'tech')
const order = (set) => (set === 'tech' ? [...TECH_CATEGORIES.map(([name]) => name), 'More brands'] : null)
const rank = (icon) => order(icon.s)?.indexOf(icon.c) ?? 0
const icons = [...tech, ...aws].sort((a, b) => a.s.localeCompare(b.s) * -1 || rank(a) - rank(b) || a.c.localeCompare(b.c) || a.n.localeCompare(b.n))
const sets = [
  { id: 'tech', label: 'Tech logos', categories: [...TECH_CATEGORIES.map(([name]) => name), 'More brands'] },
  { id: 'aws', label: 'AWS', categories: [...new Set(aws.map((icon) => icon.c))].sort((a, b) => a.localeCompare(b)) },
]
writeFileSync(manifestPath, `${JSON.stringify({ sets, icons })}\n`)
for (const set of sets) console.log(`${set.label}: ${icons.filter((icon) => icon.s === set.id).length} icons`)
