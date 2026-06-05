import { useState } from 'react'
import { Plus, Trash2, Save } from 'lucide-react'
import { useSchemasStore, type SchemaEntry } from '@/stores/schemas'
import { cn } from '@/lib/utils'

const STARTER_SCHEMA = JSON.stringify(
  {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  null,
  2,
)

export function SchemasPanel() {
  const { schemas, addSchema, updateSchema, removeSchema } = useSchemasStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editSchema, setEditSchema] = useState('')
  const [jsonError, setJsonError] = useState('')

  const selected = schemas.find((s) => s.id === selectedId) ?? null

  const selectSchema = (entry: SchemaEntry) => {
    setSelectedId(entry.id)
    setEditName(entry.name)
    setEditDesc(entry.description)
    setEditSchema(entry.schema)
    setJsonError('')
  }

  const handleNew = () => {
    const created = addSchema({ name: 'NewModel', schema: STARTER_SCHEMA, description: '' })
    selectSchema(created)
  }

  const handleSave = () => {
    if (!selectedId) return
    try {
      JSON.parse(editSchema)
      setJsonError('')
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e))
      return
    }
    updateSchema(selectedId, { name: editName, description: editDesc, schema: editSchema })
  }

  const handleDelete = (id: string) => {
    removeSchema(id)
    if (selectedId === id) {
      setSelectedId(null)
      setEditName('')
      setEditDesc('')
      setEditSchema('')
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: schema list */}
      <div className="w-[200px] border-r border-border-1 flex flex-col bg-surface-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
          <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">Schemas</span>
          <button
            onClick={handleNew}
            className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors"
            title="New schema"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {schemas.map((s) => (
            <div
              key={s.id}
              onClick={() => selectSchema(s)}
              className={cn(
                'group flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] transition-colors',
                selectedId === s.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              <span className="flex-1 truncate font-mono">{s.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(s.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 text-text-4 hover:text-error transition-all shrink-0"
                title="Delete schema"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          {schemas.length === 0 && (
            <p className="px-3 py-4 text-[10px] text-text-4 text-center">
              No schemas.
              <br />
              Click + to add one.
            </p>
          )}
        </div>
      </div>

      {/* Right: editor */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-medium text-text-2 block mb-1">Name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full h-7 px-2 text-[11px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
              />
            </div>
            <button
              onClick={handleSave}
              className="mt-5 h-7 px-3 flex items-center gap-1.5 text-[11px] bg-accent text-white rounded hover:bg-accent-hover transition-colors"
            >
              <Save size={11} />
              Save
            </button>
          </div>
          <div>
            <label className="text-[10px] font-medium text-text-2 block mb-1">Description</label>
            <input
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="Optional description"
              className="w-full h-7 px-2 text-[11px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
            />
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium text-text-2">JSON Schema</label>
              <span className="text-[9px] text-text-4">
                Reference: <code className="font-mono text-accent">#/components/schemas/{editName}</code>
              </span>
            </div>
            <textarea
              value={editSchema}
              onChange={(e) => {
                setEditSchema(e.target.value)
                setJsonError('')
              }}
              className="flex-1 px-2 py-1.5 text-[11px] font-mono bg-surface-1 border border-border-2 rounded text-text-1 focus:border-accent outline-none resize-none"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault()
                  handleSave()
                }
              }}
            />
            {jsonError && <p className="text-[9px] text-error mt-1">{jsonError}</p>}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[10px] text-text-4">
          Select a schema to edit it, or click + to create one.
        </div>
      )}
    </div>
  )
}
