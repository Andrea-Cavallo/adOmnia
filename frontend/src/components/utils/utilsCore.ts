export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function jsonToYaml(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (obj === null) return 'null'
  if (typeof obj === 'boolean') return String(obj)
  if (typeof obj === 'number') return String(obj)
  if (typeof obj === 'string') return `"${obj}"`
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]'
    return obj.map((item) => `${pad}- ${jsonToYaml(item, indent + 1).trimStart()}`).join('\n')
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 0) return '{}'
    return keys.map((k) => `${pad}${k}: ${jsonToYaml(record[k], indent + 1).trimStart()}`).join('\n')
  }
  return String(obj)
}

export function yamlToJson(yaml: string): string {
  try {
    const lines = yaml.split('\n').filter((l) => l.trim())
    const obj: Record<string, unknown> = {}
    let currentKey = ''
    for (const line of lines) {
      const match = line.match(/^(\s*)([\w-]+):\s*(.*)/)
      if (!match) continue
      const [, , key, value] = match
      if (value.startsWith('- ')) {
        obj[key] = value.split('- ').filter(Boolean)
      } else if (value === 'true' || value === 'false') {
        obj[key] = value === 'true'
      } else if (/^\d+(\.\d+)?$/.test(value)) {
        obj[key] = Number(value)
      } else if (value === 'null' || value === '') {
        obj[key] = null
      } else {
        obj[key] = value.replace(/^"/, '').replace(/"$/, '')
      }
      currentKey = key
    }
    if (currentKey === '') return yaml
    return JSON.stringify(obj, null, 2)
  } catch {
    return 'Invalid YAML'
  }
}

export function generatePassword(len: number, upper: boolean, nums: boolean, syms: boolean): string {
  let chars = 'abcdefghijklmnopqrstuvwxyz'
  if (upper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (nums) chars += '0123456789'
  if (syms) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function formatTimestamp(ts: number): { utc: string; local: string; unix: number; iso: string } {
  const d = new Date(ts)
  return {
    utc: d.toUTCString(),
    local: d.toLocaleString(),
    unix: Math.floor(ts / 1000),
    iso: d.toISOString(),
  }
}

export function fakeName() {
  const firstNames = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi']
  return firstNames[Math.floor(Math.random() * firstNames.length)]
}

export function fakeEmail() {
  return `${fakeName().toLowerCase()}@example.com`
}

export function fakePhone() {
  return `+1-${Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}`
}

export function fakeIP() {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.')
}

export function fakeWords(n: number) {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ')
  return Array.from({ length: n }, () => words[Math.floor(Math.random() * words.length)]).join(' ')
}

export function parseQuery(q: string): Record<string, string> {
  const params = new URLSearchParams(q)
  const obj: Record<string, string> = {}
  params.forEach((v, k) => { obj[k] = v })
  return obj
}
