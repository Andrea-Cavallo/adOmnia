import { forwardRef, useImperativeHandle, useRef, type UIEventHandler } from 'react'

import { cn } from '@/lib/utils'
import { useMermaidBlocks } from './mermaidBlocks'

interface MarkdownPreviewProps {
  className?: string
  html: string
  onInternalLink: (href: string) => void
  onScroll?: UIEventHandler<HTMLDivElement>
}

export const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(function MarkdownPreview({
  className,
  html,
  onInternalLink,
  onScroll,
}, ref) {
  const container = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => container.current as HTMLDivElement)
  useMermaidBlocks(container, html)
  return (
    <div
      ref={container}
      data-a11y-click-exempt="delegated-native-links"
      className={cn('flex-1 p-5 overflow-y-auto bg-surface-0', className)}
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
