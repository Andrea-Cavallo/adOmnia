import type { KeyboardEvent, ReactNode } from 'react'
import { hitConditionError, type BreakpointDraft } from './goStudioBreakpoints'

interface GoStudioBreakpointFieldsProps {
  draft: BreakpointDraft
  onChange: (draft: BreakpointDraft) => void
  /** Invio in un campo: applica. */
  onSubmit: () => void
  /** I breakpoint di funzione non hanno logpoint. */
  allowLog?: boolean
  autoFocus?: boolean
}

const INPUT = 'h-7 w-full rounded-md border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent'

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-3">{label}</span>
      {children}
      {(error || hint) && <span className={`mt-1 block text-[10px] ${error ? 'text-danger' : 'text-text-4'}`}>{error || hint}</span>}
    </label>
  )
}

/** Condizione, hit count e logpoint: lo stesso form nel popover del gutter e nel dialog Breakpoints. */
export function GoStudioBreakpointFields({ draft, onChange, onSubmit, allowLog = true, autoFocus }: GoStudioBreakpointFieldsProps) {
  const update = (patch: Partial<BreakpointDraft>) => onChange({ ...draft, ...patch })
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') { event.preventDefault(); onSubmit() }
  }
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[11px] text-text-2">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} className="accent-accent" />
        Enabled
      </label>
      <Field label="Condition" hint="Stops only when this Go expression is true">
        <input autoFocus={autoFocus} value={draft.condition} onChange={(event) => update({ condition: event.target.value })} onKeyDown={onKeyDown} placeholder="len(items) > 10" spellCheck={false} className={INPUT} />
      </Field>
      <Field label="Hit count" hint="3 = only the 3rd time · >= 5 · % 10 = every 10th" error={hitConditionError(draft.hitCondition)}>
        <input value={draft.hitCondition} onChange={(event) => update({ hitCondition: event.target.value })} onKeyDown={onKeyDown} placeholder=">= 5" spellCheck={false} className={INPUT} />
      </Field>
      {allowLog && (
        <div>
          <label className="mb-1.5 flex items-center gap-2 text-[11px] text-text-2">
            <input type="checkbox" checked={draft.log} onChange={(event) => update({ log: event.target.checked })} className="accent-accent" />
            Log a message instead of stopping
          </label>
          {draft.log && (
            <Field label="Message" hint="{expression} is evaluated when the line runs; output goes to the Debug console">
              <input autoFocus value={draft.logMessage} onChange={(event) => update({ logMessage: event.target.value })} onKeyDown={onKeyDown} placeholder="user = {user.ID}" spellCheck={false} className={INPUT} />
            </Field>
          )}
        </div>
      )}
    </div>
  )
}

export function canApply(draft: BreakpointDraft): boolean {
  return hitConditionError(draft.hitCondition) === null
}
