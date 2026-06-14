import { pointToScreen, type PdfToolId } from '@/lib/pdf/annotationModel'
import type { FormWidget } from '@/lib/pdf/pdfDocument'

interface FormFieldLayerProps {
  widgets: FormWidget[]
  zoom: number
  tool: PdfToolId
  formValues: Record<string, string | boolean>
  onChange: (name: string, value: string | boolean) => void
}

// Overlay of interactive inputs positioned over the original AcroForm widgets.
// Only active when the `select` tool is chosen, so it never blocks annotating.
export function FormFieldLayer({ widgets, zoom, tool, formValues, onChange }: FormFieldLayerProps) {
  if (widgets.length === 0) return null
  const px = (pt: number) => pointToScreen(pt, zoom)
  const interactive = tool === 'select'

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
      {widgets.map((widget, idx) => {
        const value = formValues[widget.name] ?? widget.defaultValue
        const style: React.CSSProperties = {
          position: 'absolute',
          left: px(widget.x),
          top: px(widget.y),
          width: px(widget.w),
          height: px(widget.h),
          pointerEvents: interactive ? 'auto' : 'none',
        }

        if (widget.type === 'checkbox' || widget.type === 'radio') {
          return (
            <input
              key={`${widget.name}_${idx}`}
              type={widget.type === 'radio' ? 'radio' : 'checkbox'}
              checked={value === true || (typeof value === 'string' && value === widget.exportValue)}
              onChange={(e) =>
                onChange(widget.name, widget.type === 'radio' ? (widget.exportValue ?? 'On') : e.target.checked)
              }
              style={{ ...style, accentColor: 'var(--color-accent, #6366f1)' }}
            />
          )
        }

        if (widget.type === 'choice') {
          return (
            <select
              key={`${widget.name}_${idx}`}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(widget.name, e.target.value)}
              style={{ ...style, fontSize: Math.max(8, px(10)), border: '1px solid var(--color-accent, #6366f1)', background: 'rgba(99,102,241,0.06)' }}
            >
              <option value="" />
              {(widget.options ?? []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )
        }

        // text
        return (
          <input
            key={`${widget.name}_${idx}`}
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(widget.name, e.target.value)}
            title={widget.name}
            style={{
              ...style,
              fontSize: Math.max(8, px(11)),
              padding: '0 2px',
              border: '1px solid var(--color-accent, #6366f1)',
              background: 'rgba(99,102,241,0.06)',
              color: 'var(--color-text-1, #111)',
              outline: 'none',
            }}
          />
        )
      })}
    </div>
  )
}
