/** Resolve the target file's language, which can differ from the editor that opened the popup. */
export function previewLanguage(
  path: string,
  languages: ReadonlyArray<{
    id: string
    extensions?: readonly string[]
    filenames?: readonly string[]
  }>,
): string {
  const name = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  const exact = languages.find((language) =>
    language.filenames?.some((file) => file.toLowerCase() === name),
  )
  if (exact) return exact.id
  return (
    languages
      .flatMap((language) =>
        (language.extensions ?? [])
          .filter((extension) => name.endsWith(extension.toLowerCase()))
          .map((extension) => ({ id: language.id, length: extension.length })),
      )
      .sort((a, b) => b.length - a.length)[0]?.id ?? 'plaintext'
  )
}
