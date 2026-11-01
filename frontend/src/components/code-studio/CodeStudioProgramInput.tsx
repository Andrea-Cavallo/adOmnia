import type { Ref } from 'react'
import { CornerDownLeft, Terminal } from 'lucide-react'

export function CodeStudioProgramInput({ inputRef, value, onChange, onSubmit }: { inputRef: Ref<HTMLInputElement>; value: string; onChange: (value: string) => void; onSubmit: () => void }) {
  return <form aria-label="Send input to the running program" onSubmit={event => { event.preventDefault(); onSubmit() }} className="flex shrink-0 items-center gap-3 border-t border-border-2 bg-surface-1 px-3 py-2">
    <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-text-2" title="Standard input for the running program"><Terminal size={14} aria-hidden="true" />Input</span>
    <div className="flex min-w-0 flex-1 items-center rounded-md border border-border-2 bg-surface-0 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30">
      <input ref={inputRef} value={value} onChange={event => onChange(event.target.value)} aria-label="Program input" className="h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] leading-6 text-text-1 placeholder:text-text-3 focus:outline-none" placeholder="Type input for the program…" autoComplete="off" spellCheck={false} />
      <button type="submit" aria-label="Send program input" title="Send input · Enter (also sends empty lines)" onMouseDown={event => event.preventDefault()} className="mr-1 flex h-8 shrink-0 items-center gap-1.5 rounded border border-border-2 bg-surface-2 px-2.5 text-[12px] font-medium text-text-1 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"><span>Send</span><CornerDownLeft size={14} aria-hidden="true" /></button>
    </div>
  </form>
}
