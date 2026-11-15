import { EditorAttributes } from '@onlook/constants'
import { addOidsToAst, getAstFromContent, getContentFromAst, traverse, type T } from '@onlook/parser'

interface TextEdit {
  start: number
  end: number
  text: string
}

interface Positioned {
  start?: number | null
  end?: number | null
}

const ID_ATTRIBUTE: string = EditorAttributes.DATA_ONLOOK_ID

function isIdAttribute(attribute: T.JSXAttribute | T.JSXSpreadAttribute): attribute is T.JSXAttribute {
  return attribute.type === 'JSXAttribute' && attribute.name.name === ID_ATTRIBUTE
}

function hasRange(node: Positioned): node is { start: number; end: number } {
  return typeof node.start === 'number' && typeof node.end === 'number'
}

/** Range of an attribute including the whitespace before it, so removing it leaves no gap. */
function attributeRange(content: string, attribute: { start: number; end: number }): TextEdit {
  let start = attribute.start
  while (start > 0 && /\s/.test(content[start - 1] ?? '')) start--
  return { start, end: attribute.end, text: '' }
}

function applyEdits(content: string, edits: TextEdit[]): string {
  let out = content
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return out
}

/** Where a new attribute goes: after the last attribute that exists in the source, else after the tag name. */
function insertionPoint(element: T.JSXOpeningElement): number | null {
  const anchors: Positioned[] = [element.name, ...(element.typeParameters ? [element.typeParameters] : []), ...element.attributes]
  let point: number | null = null
  for (const anchor of anchors) if (hasRange(anchor)) point = Math.max(point ?? 0, anchor.end)
  return point
}

export interface IdInjection {
  content: string
  modified: boolean
}

/**
 * Gives every JSX element of a source file a stable id attribute. The ids are chosen by the
 * transplanted `addOidsToAst`; this function only decides how they reach the file: as text
 * insertions at the positions the parser reports, so the rest of the file (formatting,
 * comments, quotes) is left byte-for-byte as the user wrote it. When an edit cannot be placed
 * safely it falls back to regenerating the file from the AST, as the original pipeline does.
 */
export async function injectIds(content: string, knownIds: Set<string>): Promise<IdInjection> {
  const ast = getAstFromContent(content)
  if (!ast) return { content, modified: false }

  // Id attributes present before the pass: the ones that disappear must be deleted from the text.
  const before = new Map<T.JSXOpeningElement, T.JSXAttribute[]>()
  traverse(ast, {
    JSXOpeningElement(path) {
      before.set(path.node, path.node.attributes.filter(isIdAttribute))
    },
  })

  const { modified } = addOidsToAst(ast, knownIds)
  if (!modified) return { content, modified: false }

  const edits: TextEdit[] = []
  let placeable = true
  traverse(ast, {
    JSXOpeningElement(path) {
      const element = path.node
      const current = element.attributes.filter(isIdAttribute)
      for (const old of before.get(element) ?? []) {
        if (current.includes(old)) continue
        if (hasRange(old)) edits.push(attributeRange(content, old))
        else placeable = false
      }
      for (const attribute of current) {
        const value = attribute.value?.type === 'StringLiteral' ? attribute.value.value : ''
        if (!hasRange(attribute)) {
          const at = insertionPoint(element)
          if (at === null) placeable = false
          else edits.push({ start: at, end: at, text: ` ${ID_ATTRIBUTE}="${value}"` })
        } else if (attribute.value && !hasRange(attribute.value)) {
          // The value was replaced (duplicate id): rewrite the whole attribute.
          edits.push({ start: attribute.start, end: attribute.end, text: `${ID_ATTRIBUTE}="${value}"` })
        }
      }
    },
  })

  if (!placeable) return { content: await getContentFromAst(ast, content), modified: true }
  return { content: applyEdits(content, edits), modified: true }
}

/** Removes every id attribute from a source file, touching nothing else. */
export function stripIds(content: string): IdInjection {
  const ast = getAstFromContent(content)
  if (!ast) return { content, modified: false }
  const edits: TextEdit[] = []
  traverse(ast, {
    JSXOpeningElement(path) {
      for (const attribute of path.node.attributes) {
        if (isIdAttribute(attribute) && hasRange(attribute)) edits.push(attributeRange(content, attribute))
      }
    },
  })
  return edits.length === 0 ? { content, modified: false } : { content: applyEdits(content, edits), modified: true }
}
