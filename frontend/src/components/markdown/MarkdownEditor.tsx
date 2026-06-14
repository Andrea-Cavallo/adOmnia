import { forwardRef, type UIEventHandler } from 'react'
import { cn } from '@/lib/utils'
import type { MarkdownViewMode } from '@/lib/markdownDoc'

interface MarkdownEditorProps {
  className?: string
  content: string
  mode: MarkdownViewMode
  onChange: (value: string) => void
  onScroll?: UIEventHandler<HTMLTextAreaElement>
}

export const MarkdownEditor = forwardRef<HTMLTextAreaElement, MarkdownEditorProps>(function MarkdownEditor({
  className,
  content,
  mode,
  onChange,
  onScroll,
}, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'md-editor-textarea p-4 bg-surface-0 font-mono text-xs text-text-1',
        'placeholder:text-text-4 resize-none focus:outline-none overflow-y-auto leading-relaxed',
        mode === 'split' ? 'flex-1 border-r border-border-1' : 'flex-1',
        className,
      )}
      value={content}
      onChange={(event) => onChange(event.target.value)}
      onScroll={onScroll}
      placeholder="Write markdown here..."
      spellCheck={false}
    />
  )
})
