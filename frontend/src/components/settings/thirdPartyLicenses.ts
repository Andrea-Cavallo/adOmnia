/**
 * What adOmnia ships, by license, as shown in Settings > About. Licenses were read from each
 * package. thirdPartyLicenses.test.ts fails when a direct dependency in package.json or go.mod
 * is missing here. New code must have a GPL-3.0-compatible license.
 */
export const THIRD_PARTY_LICENSES: ReadonlyArray<{ license: string; packages: readonly string[] }> = [
  {
    license: 'MIT',
    packages: [
      '@apidevtools/openapi-schemas', '@monaco-editor/react', '@radix-ui/react-tabs', '@taplo/lib', '@wailsio/runtime', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/xterm',
      'ajv', 'ajv-formats', 'clsx', 'emmet', 'mermaid', 'monaco-editor', 'monaco-emacs', 'monaco-vim', 'monaco-yaml', 'pdf-lib', 'prettier', 'react', 'react-dom', 'Tailwind CSS', 'tailwind-merge', 'y-monaco', 'y-protocols', 'yjs', 'zustand',
      'github.com/HdrHistogram/hdrhistogram-go', 'github.com/IBM/sarama', 'github.com/aymanbagabas/go-pty', 'github.com/dop251/goja', 'github.com/dustin/go-humanize', 'github.com/gabriel-vasile/mimetype', 'github.com/gaissmai/bart', 'github.com/jackc/pgx/v5', 'github.com/pavlo-v-chernykh/keystore-go/v4', 'github.com/tidwall/gjson', 'github.com/tidwall/sjson', 'github.com/wI2L/jsondiff', 'github.com/wailsapp/wails/v3', 'github.com/youmark/pkcs8', 'github.com/zalando/go-keyring', 'go.etcd.io/bbolt',
    ],
  },
  {
    license: 'Apache-2.0',
    packages: [
      'class-variance-authority', 'pdfjs-dist',
      'github.com/aws/aws-sdk-go-v2', 'github.com/aws/aws-sdk-go-v2/config', 'github.com/aws/aws-sdk-go-v2/service/bedrock', 'github.com/aws/aws-sdk-go-v2/service/bedrockruntime', 'github.com/google/pprof', 'github.com/jchv/go-webview2', 'github.com/jhump/protoreflect', 'github.com/nats-io/nats.go', 'github.com/tetratelabs/wazero', 'github.com/xdg-go/scram', 'go.mongodb.org/mongo-driver/v2', 'go.opentelemetry.io/proto/otlp', 'google.golang.org/grpc',
    ],
  },
  {
    license: 'BSD-3-Clause',
    packages: [
      'filippo.io/age', 'github.com/digitorus/pdf', 'github.com/fsnotify/fsnotify', 'github.com/miekg/dns', 'github.com/romshark/jscan', 'github.com/shirou/gopsutil/v4',
      'golang.org/x/exp', 'golang.org/x/mod', 'golang.org/x/net', 'golang.org/x/sync', 'golang.org/x/sys', 'golang.org/x/tools', 'google.golang.org/protobuf', 'modernc.org/sqlite', 'software.sslmate.com/src/go-pkcs12',
    ],
  },
  { license: 'BSD-2-Clause', packages: ['github.com/digitorus/pdfsign', 'github.com/gorilla/websocket', 'github.com/rabbitmq/amqp091-go', 'github.com/redis/go-redis/v9'] },
  { license: 'ISC', packages: ['d3-force', 'lucide-react', 'yaml'] },
  { license: 'MPL-2.0', packages: ['github.com/go-sql-driver/mysql'] },
  { license: 'EPL-2.0 or EDL-1.0', packages: ['github.com/eclipse/paho.mqtt.golang'] },
  { license: 'MIT and Apache-2.0', packages: ['gopkg.in/yaml.v3'] },
  { license: 'MIT or Unlicense', packages: ['ripgrep'] },
  {
    license: 'SIL OFL-1.1 (fonts)',
    packages: ['@fontsource/architects-daughter', '@fontsource/doto', '@fontsource/fira-code', '@fontsource/geist', '@fontsource/geist-mono', '@fontsource/ibm-plex-mono', '@fontsource/inter', '@fontsource/jetbrains-mono', '@fontsource/monaspace-radon', '@fontsource/recursive', '@fontsource/roboto-mono', '@fontsource/source-code-pro', '@fontsource/space-mono'],
  },
  { license: 'Ubuntu Font License 1.0 (font)', packages: ['@fontsource/ubuntu-mono'] },
]
