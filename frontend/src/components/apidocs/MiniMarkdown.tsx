import { Fragment } from 'react'
import { openExternal } from '@/lib/openExternal'

// Safe, dependency-free markdown for OpenAPI descriptions. Renders React nodes
// (never innerHTML) so a spec fetched from an untrusted URL cannot inject markup.
// Supports the subset that shows up in real specs: links, bold, italic, inline
// code, paragraphs, and unordered lists.

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g

function inlineNodes(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let i = 0
  INLINE.lastIndex = 0
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const key = `${keyBase}-${i++}`
    if (m[1] && m[2]) {
      const href = m[2]
      nodes.push(
        <a
          key={key}
          href={href}
          onClick={(e) => { e.preventDefault(); openExternal(href) }}
          className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {m[1]}
        </a>,
      )
    } else if (m[3] || m[4]) {
      nodes.push(<strong key={key} className="font-semibold text-text-1">{m[3] ?? m[4]}</strong>)
    } else if (m[5]) {
      nodes.push(<code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.92em] text-text-1">{m[5]}</code>)
    } else {
      nodes.push(<em key={key} className="italic">{m[6] ?? m[7]}</em>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Inline-only markdown for short, single-line descriptions. */
export function InlineMarkdown({ text }: { text: string }) {
  return <>{inlineNodes(text, 'i')}</>
}

/** Block markdown (paragraphs + unordered lists) for rich descriptions. */
export function MiniMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split(/\n/)
        const isList = lines.every((l) => /^\s*[-*]\s+/.test(l))
        if (isList) {
          return (
            <ul key={bi} className="my-1.5 list-disc space-y-0.5 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{inlineNodes(l.replace(/^\s*[-*]\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bi} className="my-1.5 first:mt-0 last:mb-0">
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inlineNodes(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
