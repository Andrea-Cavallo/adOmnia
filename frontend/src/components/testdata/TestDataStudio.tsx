import { useState, useCallback } from 'react'
import { Copy, RefreshCw, Download, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

// ─── Faker generators (no external lib) ──────────────────────

const names = ['Mario', 'Luigi', 'Giovanni', 'Francesca', 'Sofia', 'Alessandro', 'Giulia', 'Lorenzo', 'Chiara', 'Matteo', 'Valentina', 'Riccardo', 'Elena', 'Andrea', 'Martina']
const surnames = ['Rossi', 'Bianchi', 'Verdi', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'Costa']
const domains = ['gmail.com', 'yahoo.it', 'outlook.com', 'libero.it', 'hotmail.com', 'icloud.com', 'proton.me']
const streets = ['Via Roma', 'Corso Italia', 'Via Garibaldi', 'Piazza Duomo', 'Viale Europa', 'Via Verdi', 'Corso Vittorio Emanuele']
const cities = ['Milano', 'Roma', 'Napoli', 'Torino', 'Palermo', 'Bologna', 'Firenze', 'Genova', 'Bari', 'Catania', 'Venezia', 'Verona']
const provinces = ['MI', 'RM', 'NA', 'TO', 'PA', 'BO', 'FI', 'GE', 'BA', 'CT', 'VE', 'VR']
const caps = ['20121', '00100', '80100', '10100', '90100', '40100', '50100', '16100', '70100', '95100', '30100', '37100']
const productNames = ['Widget Pro', 'SuperScrew', 'MegaBolt', 'NanoSpring', 'HyperGear', 'UltraWeld', 'TurboPipe', 'MaxiJoint']
const descriptions = ['High quality', 'Industrial grade', 'Premium', 'Standard', 'Professional', 'Heavy duty', 'Lightweight']

let _seed = 42
function rng(): number { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647 }
function pick<T>(arr: T[]): T { return arr[Math.floor(rng() * arr.length)] }
function randInt(min: number, max: number): number { return Math.floor(rng() * (max - min + 1)) + min }

function genName(): string { return pick(names) }
function genSurname(): string { return pick(surnames) }
function genEmail(first?: string, last?: string): string {
  const f = (first || pick(names)).toLowerCase()
  const l = (last || pick(surnames)).toLowerCase()
  return `${f}.${l}@${pick(domains)}`
}
function genUsername(): string {
  const adj = ['red', 'blue', 'dark', 'wild', 'cool', 'fast', 'bold', 'gold', 'neon']
  const noun = ['wolf', 'tiger', 'eagle', 'fox', 'hawk', 'bear', 'lion', 'deer']
  return `${pick(adj)}_${pick(noun)}${randInt(1, 999)}`
}
function genPhone(): string {
  const prefixes = ['320', '333', '335', '338', '339', '340', '345', '347', '348', '349', '366', '388', '389']
  return `+39 ${pick(prefixes)} ${randInt(1000000, 9999999)}`
}
function genIp(): string { return `${randInt(10, 254)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}` }
function genUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}
function genDate(minYear = 2020, maxYear = 2026): string {
  const year = randInt(minYear, maxYear)
  const month = String(randInt(1, 12)).padStart(2, '0')
  const day = String(randInt(1, 28)).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function genIban(): string {
  const cc = 'IT'
  const cin = String(randInt(0, 99)).padStart(2, '0')
  const abi = String(randInt(10000, 99999)).padStart(5, '0')
  const cab = String(randInt(10000, 99999)).padStart(5, '0')
  const account = String(randInt(100000000000, 999999999999))
  return `${cc}${cin}Z${abi}${cab}${account}`
}
function genCodiceFiscale(): string {
  const consonants = 'BCDFGHJKLMNPQRSTVWXYZ'
  const vowels = 'AEIOU'
  const surname = pick(surnames).toUpperCase()
  const name = pick(names).toUpperCase()
  let cf = ''
  // Surname: first 3 consonants
  for (const c of surname) { if (consonants.includes(c) && cf.length < 3) cf += c }
  for (const c of surname) { if (vowels.includes(c) && cf.length < 3) cf += c }
  while (cf.length < 3) cf += 'X'
  // Name: first 3 consonants
  let namePart = ''
  for (const c of name) { if (consonants.includes(c) && namePart.length < 3) namePart += c }
  for (const c of name) { if (vowels.includes(c) && namePart.length < 3) namePart += c }
  while (namePart.length < 3) namePart += 'X'
  cf += namePart
  // Year
  const y = String(randInt(0, 99)).padStart(2, '0')
  cf += y
  // Month
  cf += String.fromCharCode(65 + randInt(0, 11))
  // Day + gender
  cf += String(randInt(1, 31)).padStart(2, '0')
  // City code
  cf += pick(['H501', 'F205', 'L219', 'G482', 'A944', 'D612'])
  // Check char
  cf += String.fromCharCode(65 + randInt(0, 25))
  return cf
}
function genPartitaIva(): string { return String(randInt(10000000000, 99999999999)) }
function genStreet(): string { return `${pick(streets)} ${randInt(1, 200)}` }
function genCity(): string { return pick(cities) }
function genProvince(): string { return pick(provinces) }
function genCap(): string { return pick(caps) }
function genLorem(minWords = 5, maxWords = 20): string {
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud']
  const count = randInt(minWords, maxWords)
  const result: string[] = []
  for (let i = 0; i < count; i++) result.push(pick(words))
  return result.join(' ') + '.'
}

type GeneratorId = 'name' | 'surname' | 'email' | 'username' | 'phone' | 'ip' | 'uuid' | 'date' | 'iban' | 'cf' | 'piva' | 'street' | 'city' | 'province' | 'cap' | 'lorem' | 'int' | 'float' | 'bool' | 'product' | 'desc' | 'custom'

interface Generator {
  id: GeneratorId
  label: string
  category: string
  fn: () => string
}

const generators: Generator[] = [
  { id: 'name', label: 'Name', category: 'Person', fn: genName },
  { id: 'surname', label: 'Surname', category: 'Person', fn: genSurname },
  { id: 'email', label: 'Email', category: 'Person', fn: () => genEmail() },
  { id: 'username', label: 'Username', category: 'Person', fn: genUsername },
  { id: 'phone', label: 'Phone', category: 'Contact', fn: genPhone },
  { id: 'ip', label: 'IP Address', category: 'Tech', fn: genIp },
  { id: 'uuid', label: 'UUID', category: 'Tech', fn: genUuid },
  { id: 'date', label: 'Date', category: 'General', fn: () => genDate() },
  { id: 'iban', label: 'IBAN', category: 'Finance', fn: genIban },
  { id: 'cf', label: 'Codice Fiscale', category: 'Italy', fn: genCodiceFiscale },
  { id: 'piva', label: 'Partita IVA', category: 'Italy', fn: genPartitaIva },
  { id: 'street', label: 'Street', category: 'Address', fn: genStreet },
  { id: 'city', label: 'City', category: 'Address', fn: genCity },
  { id: 'province', label: 'Province', category: 'Address', fn: genProvince },
  { id: 'cap', label: 'CAP', category: 'Address', fn: genCap },
  { id: 'lorem', label: 'Lorem Ipsum', category: 'Text', fn: () => genLorem() },
  { id: 'int', label: 'Integer', category: 'General', fn: () => String(randInt(0, 9999)) },
  { id: 'float', label: 'Float', category: 'General', fn: () => (rng() * 1000).toFixed(2) },
  { id: 'bool', label: 'Boolean', category: 'General', fn: () => String(Math.random() > 0.5) },
  { id: 'product', label: 'Product', category: 'Commerce', fn: () => pick(productNames) },
  { id: 'desc', label: 'Description', category: 'Text', fn: () => pick(descriptions) },
  { id: 'custom', label: 'Custom (constant)', category: 'Custom', fn: () => '' },
]

interface Preset {
  name: string
  fields: Field[]
  count: number
  format: 'json' | 'csv'
}

const PRESETS_KEY = 'adomnia.testdata.presets'

interface Field {
  id: string
  generatorId: GeneratorId
  fieldName: string
}

export function TestDataStudio() {
  const [fields, setFields] = useState<Field[]>([
    { id: '1', generatorId: 'name', fieldName: 'firstName' },
    { id: '2', generatorId: 'surname', fieldName: 'lastName' },
    { id: '3', generatorId: 'email', fieldName: 'email' },
  ])
  const [count, setCount] = useState(5)
  const [output, setOutput] = useState('')
  const [format, setFormat] = useState<'json' | 'csv'>('json')
  const [customValue, setCustomValue] = useState('default')
  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState<Preset[]>(() => {
    try { const r = localStorage.getItem(PRESETS_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
  })

  const savePreset = () => {
    if (!presetName.trim()) return
    const p: Preset = { name: presetName, fields, count, format }
    const updated = [p, ...presets.filter((x) => x.name !== presetName)].slice(0, 20)
    setPresets(updated)
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(updated)) } catch { /* */ }
  }

  const loadPreset = (p: Preset) => {
    setFields(p.fields.map((f) => ({ ...f })))
    setCount(p.count)
    setFormat(p.format)
  }

  const generate = useCallback(() => {
    const genMap = new Map(generators.map((g) => [g.id, g.fn]))
    const rows: Record<string, string>[] = []

    for (let i = 0; i < count; i++) {
      const row: Record<string, string> = {}
      for (const f of fields) {
        const gen = genMap.get(f.generatorId)
        row[f.fieldName] = f.generatorId === 'custom' ? customValue : (gen ? gen() : '')
      }
      rows.push(row)
    }

    if (format === 'json') {
      setOutput(JSON.stringify(rows, null, 2))
    } else {
      const headers = fields.map((f) => f.fieldName)
      const csvRows = [
        headers.join(','),
        ...rows.map((r) => headers.map((h) => `"${(r[h] || '').replace(/"/g, '""')}"`).join(',')),
      ]
      setOutput(csvRows.join('\n'))
    }
  }, [fields, count, format])

  const addField = () => {
    setFields((f) => [...f, { id: String(Date.now()), generatorId: 'name', fieldName: `field${f.length + 1}` }])
  }

  const removeField = (id: string) => {
    setFields((f) => f.filter((x) => x.id !== id))
  }

  const categories = [...new Set(generators.map((g) => g.category))]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-1 bg-surface-1">
        <span className="text-xs font-medium text-text-2">Test Data Studio</span>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setFormat('json')} className={cn('px-2 py-0.5 text-[10px] rounded', format === 'json' ? 'bg-surface-3 text-text-1' : 'text-text-4')}>JSON</button>
          <button onClick={() => setFormat('csv')} className={cn('px-2 py-0.5 text-[10px] rounded', format === 'csv' ? 'bg-surface-3 text-text-1' : 'text-text-4')}>CSV</button>
          <span className="text-text-4 text-[10px] mx-1">Count:</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={count}
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 h-7 px-1 text-xs bg-surface-2 border border-border-1 rounded text-text-1 text-center"
          />
          <button onClick={generate} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-accent/20 text-accent hover:bg-accent/30">
            <RefreshCw size={10} /> Generate
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Field config */}
        <div className="w-64 flex-shrink-0 border-r border-border-1 flex flex-col overflow-auto">
          <div className="px-3 py-2 border-b border-border-1 flex items-center justify-between">
            <span className="text-[10px] font-medium text-text-3 uppercase">Fields</span>
            <button onClick={addField} className="text-[10px] text-accent hover:text-accent-light">+ Add</button>
          </div>

          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-1 px-2 py-1.5 border-b border-border-1/50">
              <input
                value={f.fieldName}
                onChange={(e) => setFields((fs) => fs.map((x) => x.id === f.id ? { ...x, fieldName: e.target.value } : x))}
                className="flex-1 h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 outline-none"
                placeholder="field name"
              />
              <select
                value={f.generatorId}
                onChange={(e) => setFields((fs) => fs.map((x) => x.id === f.id ? { ...x, generatorId: e.target.value as GeneratorId } : x))}
                className="h-6 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1"
              >
                {categories.map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {generators.filter((g) => g.category === cat).map((g) => (
                      <option key={g.id} value={g.id}>{g.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button onClick={() => removeField(f.id)} className="text-text-4 hover:text-error text-[10px] px-1">×</button>
            </div>
          ))}

          {fields.some((f) => f.generatorId === 'custom') && (
            <div className="px-3 py-2 border-b border-border-1">
              <span className="text-[9px] text-text-4 uppercase">Custom Value</span>
              <input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                className="w-full mt-1 h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 outline-none"
                placeholder="Enter constant value..."
              />
            </div>
          )}

          {/* Presets */}
          <div className="px-3 py-2 border-b border-border-1">
            <div className="flex items-center gap-1">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="flex-1 h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 outline-none"
                placeholder="Preset name"
              />
              <button onClick={savePreset} className="px-2 py-1 text-[10px] rounded bg-accent/20 text-accent hover:bg-accent/30">Save</button>
            </div>
          </div>

          {presets.length > 0 && (
            <div className="flex flex-col">
              <div className="px-3 py-1 text-[9px] text-text-4 uppercase">Load Preset</div>
              {presets.map((p, i) => (
                <button
                  key={i}
                  onClick={() => loadPreset(p)}
                  className="text-left px-3 py-1 text-[10px] text-text-3 hover:text-text-1 hover:bg-surface-2"
                >
                  {p.name} ({p.fields.length}f × {p.count})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Output */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-1">
            <span className="text-[10px] text-text-4">Output</span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => {
                  const blob = new Blob([output], { type: format === 'json' ? 'application/json' : 'text/csv' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `dataset-${Date.now()}.${format === 'json' ? 'json' : 'csv'}`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                disabled={!output}
                className="p-1 text-text-4 hover:text-text-1 disabled:opacity-30"
                title={`Download ${format.toUpperCase()}`}
              >
                <Download size={12} />
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(output)
                }}
                disabled={!output}
                className="p-1 text-text-4 hover:text-text-1 disabled:opacity-30"
                title="Copy to clipboard"
              >
                <Copy size={12} />
              </button>
              <button
                onClick={() => {
                  if (!output) return
                  useAppStore.getState().setActiveRail('runner')
                  const e = new CustomEvent('adomnia:dataset-from-studio', { detail: { data: output, format } })
                  window.dispatchEvent(e)
                }}
                disabled={!output}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 disabled:opacity-40"
                title="Send dataset to Collection Runner"
              >
                <Play size={9} /> Run in Runner
              </button>
            </div>
          </div>
          <textarea
            value={output}
            readOnly
            className="flex-1 p-3 text-[10px] font-mono bg-surface-1 resize-none outline-none text-text-2"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}
