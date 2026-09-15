/**
 * Character index under a screen point inside a textarea, with the browser's
 * own line wrapping. A textarea exposes no hit-testing, so an invisible mirror
 * with the same box, font, wrapping and scroll offset becomes hit-testable over
 * it for the duration of one caret query.
 */

const MIRRORED = [
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing', 'lineHeight',
  'textTransform', 'textIndent', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap', 'overflowX', 'overflowY',
] as const

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

let mirror: HTMLDivElement | null = null

/** Returns null when the point is outside the field or the engine cannot hit-test carets. */
export function textIndexAtPoint(field: HTMLTextAreaElement, clientX: number, clientY: number): number | null {
  const doc = field.ownerDocument as CaretDocument
  if (!doc.caretPositionFromPoint && !doc.caretRangeFromPoint) return null
  const rect = field.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null

  const computed = window.getComputedStyle(field)
  mirror ??= doc.createElement('div')
  const style = mirror.style
  for (const property of MIRRORED) style[property] = computed[property]
  Object.assign(style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', boxSizing: 'border-box',
    opacity: '0', zIndex: '2147483647',
  })
  // The trailing newline keeps an empty last line as tall as in the textarea.
  const text = `${field.value}\n`
  if (mirror.textContent !== text) mirror.textContent = text

  // Kept attached between calls so hovering does not re-lay out the whole text;
  // it only becomes hit-testable for this one query.
  if (mirror.parentNode !== doc.body) doc.body.appendChild(mirror)
  style.visibility = 'visible'
  style.pointerEvents = 'auto'
  try {
    mirror.scrollTop = field.scrollTop
    mirror.scrollLeft = field.scrollLeft
    let node: Node | null = null
    let offset = 0
    if (doc.caretPositionFromPoint) {
      const position = doc.caretPositionFromPoint(clientX, clientY)
      node = position?.offsetNode ?? null
      offset = position?.offset ?? 0
    } else {
      const range = doc.caretRangeFromPoint!(clientX, clientY)
      node = range?.startContainer ?? null
      offset = range?.startOffset ?? 0
    }
    if (!node || node.parentNode !== mirror) return null
    return Math.min(offset, field.value.length)
  } finally {
    style.visibility = 'hidden'
    style.pointerEvents = 'none'
  }
}
