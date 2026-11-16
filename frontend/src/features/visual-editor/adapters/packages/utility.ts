// Adapter barrel for the vendored utility package: the dependency-light helpers the editing
// engine uses. Font and image helpers of the original package depend on services adOmnia
// does not ship; the three small functions below stand in for them.
export * from '../../vendor/packages/utility/src/assert'
export * from '../../vendor/packages/utility/src/autolayout'
export * from '../../vendor/packages/utility/src/clone'
export * from '../../vendor/packages/utility/src/id'
export * from '../../vendor/packages/utility/src/math'
export * from '../../vendor/packages/utility/src/null'
export * from '../../vendor/packages/utility/src/string'
export * from '../../vendor/packages/utility/src/tailwind'
export * from '../../vendor/packages/utility/src/tw-merge'
export * from '../../vendor/packages/utility/src/unit'

/** First family of a CSS font-family list, without quotes. */
export function convertFontString(fontString: string): string {
  return (fontString.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '')
}

const NO_BACKGROUND = new Set(['img', 'video', 'audio', 'iframe', 'canvas', 'input', 'br', 'hr'])

export function canHaveBackgroundImage(tagName: string): boolean {
  return !NO_BACKGROUND.has(tagName.toLowerCase())
}

export function urlToRelativePath(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return url
  }
}
