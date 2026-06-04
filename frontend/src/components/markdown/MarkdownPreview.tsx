import { forwardRef, type UIEventHandler } from 'react'

interface MarkdownPreviewProps {
  html: string
  onInternalLink: (href: string) => void
  onScroll?: UIEventHandler<HTMLDivElement>
}

export const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(function MarkdownPreview({
  html,
  onInternalLink,
  onScroll,
}, ref) {
  return (
    <div
      ref={ref}
      className="flex-1 p-5 overflow-y-auto bg-surface-0"
      onScroll={onScroll}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a')
        const href = anchor?.getAttribute('href')
        if (!href) return
        if (href.startsWith('adomnia-md:') || !/^(https?:|mailto:|tel:|#)/i.test(href)) {
          event.preventDefault()
          onInternalLink(href)
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
