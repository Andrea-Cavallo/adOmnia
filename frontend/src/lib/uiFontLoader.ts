import type { UIFontId } from './uiFonts'

const fontLoaders: Record<UIFontId, () => Promise<unknown>> = {
  // The default ships in the initial stylesheet to avoid a font swap on the
  // common startup path. Every alternative becomes an on-demand CSS chunk.
  'ibm-plex-mono': async () => undefined,
  'jetbrains-mono': () => Promise.all([
    import('@fontsource/jetbrains-mono/400.css'),
    import('@fontsource/jetbrains-mono/500.css'),
  ]),
  'fira-code': () => Promise.all([
    import('@fontsource/fira-code/400.css'),
    import('@fontsource/fira-code/500.css'),
  ]),
  'source-code-pro': () => Promise.all([
    import('@fontsource/source-code-pro/400.css'),
    import('@fontsource/source-code-pro/500.css'),
  ]),
  'roboto-mono': () => Promise.all([
    import('@fontsource/roboto-mono/400.css'),
    import('@fontsource/roboto-mono/500.css'),
  ]),
  'space-mono': () => import('@fontsource/space-mono/400.css'),
  'ubuntu-mono': () => import('@fontsource/ubuntu-mono/400.css'),
  recursive: () => import('@fontsource/recursive/400.css'),
  'cascadia-code': async () => undefined,
  inter: () => Promise.all([
    import('@fontsource/inter/400.css'),
    import('@fontsource/inter/500.css'),
  ]),
  geist: () => import('@fontsource/geist/400.css'),
}

const loadingFonts = new Map<UIFontId, Promise<unknown>>()

export function loadUIFont(font: UIFontId): Promise<unknown> {
  const existing = loadingFonts.get(font)
  if (existing) return existing
  const loading = fontLoaders[font]().catch(() => undefined)
  loadingFonts.set(font, loading)
  return loading
}
