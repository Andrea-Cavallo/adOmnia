import type { MarkdownHeading } from '@/lib/markdownDoc'

interface MarkdownOutlineProps {
  headings: MarkdownHeading[]
  onJumpToLine: (line: number) => void
}

export function MarkdownOutline({ headings, onJumpToLine }: MarkdownOutlineProps) {
  return (
    <div className="max-h-36 overflow-y-auto border-b border-border-1 p-2">
      <div className="mb-1.5 text-xs font-semibold text-text-2">Outline</div>
      {headings.length === 0 ? (
        <div className="text-[11px] text-text-4">No headings in this note.</div>
      ) : headings.map((heading) => (
        <button
          key={`${heading.line}-${heading.text}`}
          onClick={() => onJumpToLine(heading.line)}
          className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] text-text-3 hover:bg-surface-1 hover:text-text-1"
          style={{ paddingLeft: 6 + Math.max(0, heading.level - 1) * 8 }}
          title={heading.text}
        >
          {heading.text}
        </button>
      ))}
    </div>
  )
}
