import { useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadText } from '@/lib/fileUtils'

type DockerOutTab = 'compose' | 'env' | 'readme'

interface DockerPreset {
  id: string
  label: string
  cat: string
  ports: string
  volumes?: string[]
  envVars?: Record<string, string>
  creds?: string
  yaml: string
}

interface DockerBundle { id: string; label: string; desc: string; includes: string[] }

const D_PRESETS: DockerPreset[] = [
  // -- Databases
  {
    id: 'postgres', label: 'PostgreSQL 17', cat: 'Database', ports: '5432',
    volumes: ['postgres-data'], creds: 'app / app',
    envVars: { POSTGRES_DB: 'app', POSTGRES_USER: 'app', POSTGRES_PASSWORD: 'app' },
    yaml: [
      '  postgres:',
      '    image: postgres:17-alpine',
      '    restart: unless-stopped',
      '    ports:',
      '      - "5432:5432"',
      '    environment:',
      '      POSTGRES_DB: ${POSTGRES_DB:-app}',
      '      POSTGRES_USER: ${POSTGRES_USER:-app}',
      '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-app}',
      '    volumes:',
      '      - postgres-data:/var/lib/postgresql/data',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app}"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  {
    id: 'mysql', label: 'MySQL 8.4', cat: 'Database', ports: '3306',
    volumes: ['mysql-data'], creds: 'app / app (root: root)',
    envVars: { MYSQL_DATABASE: 'app', MYSQL_USER: 'app', MYSQL_PASSWORD: 'app', MYSQL_ROOT_PASSWORD: 'root' },
    yaml: [
      '  mysql:',
      '    image: mysql:8.4',
      '    restart: unless-stopped',
      '    ports:',
      '      - "3306:3306"',
      '    environment:',
      '      MYSQL_DATABASE: ${MYSQL_DATABASE:-app}',
      '      MYSQL_USER: ${MYSQL_USER:-app}',
      '      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-app}',
      '      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-root}',
      '    volumes:',
      '      - mysql-data:/var/lib/mysql',
      '    healthcheck:',
      '      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  {
    id: 'mongo', label: 'MongoDB 8', cat: 'Database', ports: '27017',
    volumes: ['mongo-data'],
    envVars: { MONGO_DB: 'app' },
    yaml: [
      '  mongo:',
      '    image: mongo:8',
      '    restart: unless-stopped',
      '    ports:',
      '      - "27017:27017"',
      '    environment:',
      '      MONGO_INITDB_DATABASE: ${MONGO_DB:-app}',
      '    volumes:',
      '      - mongo-data:/data/db',
      '    healthcheck:',
      '      test: ["CMD", "mongosh", "--eval", "db.adminCommand(\'ping\')"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  {
    id: 'redis', label: 'Redis 7.4', cat: 'Database', ports: '6379',
    volumes: ['redis-data'],
    yaml: [
      '  redis:',
      '    image: redis:7.4-alpine',
      '    restart: unless-stopped',
      '    ports:',
      '      - "6379:6379"',
      '    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]',
      '    volumes:',
      '      - redis-data:/data',
      '    healthcheck:',
      '      test: ["CMD", "redis-cli", "ping"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  // -- Messaging
  {
    id: 'kafka', label: 'Kafka 3.9 + UI', cat: 'Messaging', ports: '9092, 8082',
    volumes: ['kafka-data'],
    yaml: [
      '  kafka:',
      '    image: bitnami/kafka:3.9',
      '    restart: unless-stopped',
      '    ports:',
      '      - "9092:9092"',
      '    environment:',
      '      KAFKA_CFG_NODE_ID: 1',
      '      KAFKA_CFG_PROCESS_ROLES: controller,broker',
      '      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093',
      '      KAFKA_CFG_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093',
      '      KAFKA_CFG_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092',
      '      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: CONTROLLER',
      '      KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "true"',
      '    volumes:',
      '      - kafka-data:/bitnami/kafka',
      '  kafka-ui:',
      '    image: provectuslabs/kafka-ui:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "8082:8080"',
      '    environment:',
      '      KAFKA_CLUSTERS_0_NAME: local',
      '      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092',
      '    depends_on:',
      '      - kafka',
    ].join('\n'),
  },
  {
    id: 'rabbitmq', label: 'RabbitMQ 3.13', cat: 'Messaging', ports: '5672, 15672',
    volumes: ['rabbitmq-data'], creds: 'admin / admin',
    envVars: { RABBITMQ_USER: 'admin', RABBITMQ_PASS: 'admin' },
    yaml: [
      '  rabbitmq:',
      '    image: rabbitmq:3.13-management-alpine',
      '    restart: unless-stopped',
      '    ports:',
      '      - "5672:5672"',
      '      - "15672:15672"',
      '    environment:',
      '      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-admin}',
      '      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-admin}',
      '    volumes:',
      '      - rabbitmq-data:/var/lib/rabbitmq',
      '    healthcheck:',
      '      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]',
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 5',
    ].join('\n'),
  },
  // -- Observability
  {
    id: 'prometheus', label: 'Prometheus', cat: 'Observability', ports: '9090',
    volumes: ['prometheus-data'],
    yaml: [
      '  prometheus:',
      '    image: prom/prometheus:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "9090:9090"',
      '    command:',
      '      - --config.file=/etc/prometheus/prometheus.yml',
      '      - --storage.tsdb.path=/prometheus',
      '      - --web.enable-lifecycle',
      '    volumes:',
      '      - prometheus-data:/prometheus',
    ].join('\n'),
  },
  {
    id: 'grafana', label: 'Grafana', cat: 'Observability', ports: '3000',
    volumes: ['grafana-data'], creds: 'admin / admin',
    envVars: { GRAFANA_USER: 'admin', GRAFANA_PASS: 'admin' },
    yaml: [
      '  grafana:',
      '    image: grafana/grafana:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "3000:3000"',
      '    environment:',
      '      GF_SECURITY_ADMIN_USER: ${GRAFANA_USER:-admin}',
      '      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASS:-admin}',
      '      GF_USERS_ALLOW_SIGN_UP: "false"',
      '    volumes:',
      '      - grafana-data:/var/lib/grafana',
    ].join('\n'),
  },
  {
    id: 'jaeger', label: 'Jaeger', cat: 'Observability', ports: '16686, 4317',
    yaml: [
      '  jaeger:',
      '    image: jaegertracing/all-in-one:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "16686:16686"',
      '      - "4317:4317"',
      '      - "4318:4318"',
      '    environment:',
      '      COLLECTOR_OTLP_ENABLED: "true"',
    ].join('\n'),
  },
  {
    id: 'otel', label: 'OTel Collector', cat: 'Observability', ports: '4317, 8888',
    yaml: [
      '  otel-collector:',
      '    image: otel/opentelemetry-collector-contrib:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "4317:4317"',
      '      - "4318:4318"',
      '      - "8888:8888"',
      '      - "8889:8889"',
      '    # Mount your otel-collector-config.yaml to /etc/otelcol-contrib/config.yaml',
    ].join('\n'),
  },
  // -- API & Mocking
  {
    id: 'mockapi', label: 'Mock API (Mockoon)', cat: 'API & Mocking', ports: '3001',
    yaml: [
      '  mock-api:',
      '    image: mockoon/cli:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "3001:3000"',
      '    command: ["--data", "https://raw.githubusercontent.com/mockoon/mock-samples/main/samples/generate-mock-data.json", "--port", "3000"]',
    ].join('\n'),
  },
  // -- Mail
  {
    id: 'mailpit', label: 'Mailpit', cat: 'Mail', ports: '1025, 8025',
    yaml: [
      '  mailpit:',
      '    image: axllent/mailpit:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "1025:1025"',
      '      - "8025:8025"',
      '    environment:',
      '      MP_SMTP_AUTH_ACCEPT_ANY: "true"',
      '      MP_SMTP_AUTH_ALLOW_INSECURE: "true"',
    ].join('\n'),
  },
]

const D_BUNDLES: DockerBundle[] = [
  { id: 'mock-pg',    label: 'REST Mock + PostgreSQL', desc: 'HTTP mock + relational DB',        includes: ['mockapi', 'postgres'] },
  { id: 'mock-kafka', label: 'REST Mock + Kafka',      desc: 'HTTP mock + event streaming',      includes: ['mockapi', 'kafka'] },
  { id: 'kafka-ui',  label: 'Kafka + UI',              desc: 'Kafka with web console',           includes: ['kafka'] },
  { id: 'observe',   label: 'Observability Stack',     desc: 'Prometheus + Grafana + Jaeger',    includes: ['prometheus', 'grafana', 'jaeger'] },
  { id: 'full-db',   label: 'All Databases',           desc: 'Postgres + MySQL + Mongo + Redis', includes: ['postgres', 'mysql', 'mongo', 'redis'] },
]

const D_CATS = ['Database', 'Messaging', 'Observability', 'API & Mocking', 'Mail']

function buildCompose(project: string, active: DockerPreset[]): string {
  if (!active.length) return `name: ${project || 'adomnia-lab'}\n\nservices:\n  # Select at least one preset above\n`
  const services = active.map((p) => p.yaml).join('\n\n')
  const vols = active.flatMap((p) => p.volumes ?? [])
  const volBlock = vols.length ? '\nvolumes:\n' + vols.map((v) => `  ${v}:`).join('\n') + '\n' : ''
  return `name: ${project || 'adomnia-lab'}\n\nservices:\n${services}\n${volBlock}`
}

function buildEnv(active: DockerPreset[]): string {
  const sections: string[] = ['# Generated by adOmnia · docker-compose .env\n']
  for (const p of active) {
    if (!p.envVars) continue
    sections.push(`# ${p.label}`)
    for (const [k, v] of Object.entries(p.envVars)) {
      sections.push(`${k}=${v}`)
    }
    sections.push('')
  }
  return sections.length > 1 ? sections.join('\n') : '# No configurable env vars for selected services.\n'
}

function buildReadme(project: string, active: DockerPreset[]): string {
  const name = project || 'adomnia-lab'
  const table = active.map((p) => `| ${p.label} | localhost:${p.ports.split(',')[0].trim()} | ${p.creds ?? '—'} |`).join('\n')
  const svcNames = active.map((p) => p.id)
  return [
    `# ${name} — Docker Lab`,
    '',
    `> Generated by **adOmnia** · ${new Date().toLocaleDateString()}`,
    '',
    '## Services',
    '',
    '| Service | Host | Credentials |',
    '|---------|------|-------------|',
    table || '| _(none selected)_ | — | — |',
    '',
    '## Start / Stop / Restart',
    '',
    '```bash',
    '# Start all services in background',
    `docker compose -p ${name} up -d`,
    '',
    '# Start only specific services',
    `docker compose -p ${name} up -d ${svcNames.slice(0, 2).join(' ')}`,
    '',
    '# Stop all (keep containers + volumes)',
    `docker compose -p ${name} stop`,
    '',
    '# Stop + remove containers (keep volumes)',
    `docker compose -p ${name} down`,
    '',
    '# Stop + remove containers AND volumes',
    `docker compose -p ${name} down -v`,
    '',
    '# Restart a single service',
    `docker compose -p ${name} restart <service-name>`,
    '```',
    '',
    '## Logs',
    '',
    '```bash',
    '# Follow all logs',
    `docker compose -p ${name} logs -f`,
    '',
    '# Follow a single service',
    `docker compose -p ${name} logs -f <service-name>`,
    '',
    '# Last 100 lines',
    `docker compose -p ${name} logs --tail=100`,
    '```',
    '',
    '## Live Config Changes',
    '',
    '```bash',
    '# After editing docker-compose.yml — recreate changed containers only',
    `docker compose -p ${name} up -d --no-deps <service-name>`,
    '',
    '# Force recreate all containers',
    `docker compose -p ${name} up -d --force-recreate`,
    '',
    '# Pull latest images then recreate',
    `docker compose -p ${name} pull && docker compose -p ${name} up -d`,
    '```',
    '',
    '## Inspect',
    '',
    '```bash',
    '# Status of all services',
    `docker compose -p ${name} ps`,
    '',
    '# Resource usage (CPU/RAM)',
    `docker compose -p ${name} top`,
    '',
    '# Open shell in a container',
    `docker compose -p ${name} exec <service-name> sh`,
    '```',
    '',
    '## Notes',
    '',
    '- All data is persisted in named Docker volumes — safe to restart containers.',
    '- Place `.env` next to `docker-compose.yml` to override default credentials.',
    '- Run `docker compose pull` periodically to get security patches.',
  ].join('\n')
}

const copy = (s: string) => navigator.clipboard.writeText(s).catch(() => {})

export function DockerGenerator() {
  const [selected, setSelected] = useState<string[]>([])
  const [project, setProject] = useState('adomnia-lab')
  const [outTab, setOutTab] = useState<DockerOutTab>('compose')
  const [output, setOutput] = useState<{ compose: string; env: string; readme: string } | null>(null)

  const toggle = (id: string) =>
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  const applyBundle = (b: DockerBundle) =>
    setSelected((s) => Array.from(new Set([...s, ...b.includes])))

  const generate = () => {
    const active = D_PRESETS.filter((p) => selected.includes(p.id))
    setOutput({
      compose: buildCompose(project, active),
      env:     buildEnv(active),
      readme:  buildReadme(project, active),
    })
    setOutTab('compose')
  }

  const currentOut = output ? output[outTab] : ''
  const filename: Record<DockerOutTab, string> = { compose: 'docker-compose.yml', env: '.env', readme: 'README.md' }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-3 w-24 shrink-0">Project name</span>
        <input
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="adomnia-lab"
          className="h-7 w-48 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none"
        />
      </div>

      <div>
        <p className="text-[10px] font-semibold text-text-4 uppercase tracking-wider mb-1.5">Quick bundles</p>
        <div className="flex flex-wrap gap-2">
          {D_BUNDLES.map((b) => (
            <button
              key={b.id}
              onClick={() => applyBundle(b)}
              title={b.desc}
              className="px-2.5 py-1 rounded border border-border-2 bg-surface-1 text-xs text-text-2 hover:bg-surface-2 hover:text-text-1 transition-colors"
            >
              {b.label}
            </button>
          ))}
          <button
            onClick={() => setSelected([])}
            className="px-2.5 py-1 rounded border border-border-2 bg-surface-1 text-xs text-error hover:bg-error/10 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {D_CATS.map((cat) => {
          const presets = D_PRESETS.filter((p) => p.cat === cat)
          return (
            <div key={cat}>
              <p className="text-[10px] font-semibold text-text-4 uppercase tracking-wider mb-1.5">{cat}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {presets.map((p) => (
                  <label
                    key={p.id}
                    className={cn(
                      'flex items-center gap-2 rounded border px-3 py-2 text-xs cursor-pointer transition-colors',
                      selected.includes(p.id)
                        ? 'border-accent/50 bg-accent/10 text-text-1'
                        : 'border-border-2 bg-surface-1 text-text-2 hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                      className="accent-accent"
                    />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-[9px] text-text-4 font-mono">{p.ports}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={generate}
        disabled={selected.length === 0}
        className="self-start px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        Generate ({selected.length} service{selected.length !== 1 ? 's' : ''})
      </button>

      {output && (
        <div className="flex flex-col gap-0 rounded border border-border-1 overflow-hidden">
          <div className="flex border-b border-border-1 bg-surface-1">
            {(['compose', 'env', 'readme'] as DockerOutTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setOutTab(tab)}
                className={cn(
                  'px-3 py-1.5 text-xs font-mono transition-colors',
                  outTab === tab ? 'bg-surface-2 text-text-1 border-b-2 border-accent' : 'text-text-3 hover:text-text-1',
                )}
              >
                {filename[tab]}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => copy(currentOut)}
              title="Copy to clipboard"
              className="px-3 py-1.5 text-text-3 hover:text-text-1 transition-colors"
            >
              <Copy size={12} />
            </button>
            <button
              onClick={() => downloadText(filename[outTab], currentOut, outTab === 'compose' ? 'text/yaml' : 'text/plain')}
              title="Download file"
              className="px-3 py-1.5 text-text-3 hover:text-text-1 transition-colors border-l border-border-1"
            >
              <Download size={12} />
            </button>
          </div>
          <pre className="px-4 py-3 bg-surface-0 text-xs text-text-2 font-mono whitespace-pre overflow-x-auto max-h-80">{currentOut}</pre>
        </div>
      )}
    </div>
  )
}
