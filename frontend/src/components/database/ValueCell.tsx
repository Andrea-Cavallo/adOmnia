import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { CellValue } from './dbShared'
import { isContainerValue, normalizeCell, previewValue } from './dbValue'
import { BsonInline } from './mongo/DocumentCard'

interface ValueCellProps {
  value: unknown
  /** Colonna di appartenenza, nell'header dell'Inspector. */
  column: string
  /** `mongo` rende gli scalari come `ObjectId('…')`/ISO e legge i wrapper BSON. */
  variant?: 'mongo' | 'sql'
  /** Apre l'Inspector sul valore (solo contenitori: oggetti e array). */
  onInspect: (value: unknown, kind: string) => void
}

/**
 * Cella condivisa delle griglie database (DB-1.2):
 * i contenitori mostrano una preview leggibile (`{ street: "Via Roma", city: "Milano" }`)
 * e si aprono con l'Inspector; gli scalari restano come prima.
 */
export function ValueCell({ value, column, variant = 'sql', onInspect }: ValueCellProps) {
  const driver = variant === 'mongo' ? 'mongodb' : ''
  const normalized = useMemo(() => normalizeCell(value, driver), [value, driver])
  if (!isContainerValue(normalized)) {
    return variant === 'mongo' ? <BsonInline value={value} /> : <CellValue value={value} />
  }
  const kind = Array.isArray(normalized)
    ? `Array (${normalized.length})`
    : `Object (${Object.keys(normalized).length} fields)`
  const open = () => onInspect(value, kind)
  return (
    <button
      type="button"
      onClick={open}
      title={`${kind} · ${column} — click to inspect`}
      className="group/cell flex w-full min-w-0 items-center gap-1 text-left font-mono text-[11.5px] text-text-2 hover:text-text-1"
    >
      <ChevronRight size={11} className="flex-none text-text-4 group-hover/cell:text-accent" />
      <span className="truncate">{previewValue(normalized)}</span>
    </button>
  )
}
