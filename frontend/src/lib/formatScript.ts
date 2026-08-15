/** Formats request lifecycle scripts locally in the renderer, without network access. */
export async function formatJavaScript(source: string): Promise<string> {
  if (!source.trim()) return source

  const [prettier, babel, estree] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
  ])

  return prettier.format(source, {
    parser: 'babel',
    plugins: [babel, estree],
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
  })
}
