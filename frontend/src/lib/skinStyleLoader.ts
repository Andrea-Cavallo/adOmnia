const skinLoaders: Record<string, () => Promise<unknown>> = {
  sketch: () => Promise.all([
    import('@/styles/skin-sketch.css'),
    import('@fontsource/architects-daughter/400.css'),
    import('@fontsource/monaspace-radon/400.css'),
  ]),
  'terminal-green': () => import('@/styles/skin-terminal-green.css'),
  'static-citrine': () => import('@/styles/skin-static-citrine.css'),
}

const loadingSkins = new Map<string, Promise<unknown>>()

export function loadSkinStyles(skin?: string): Promise<unknown> {
  if (!skin || !Object.prototype.hasOwnProperty.call(skinLoaders, skin)) return Promise.resolve()
  const existing = loadingSkins.get(skin)
  if (existing) return existing
  const loading = skinLoaders[skin]().catch(error => {
    loadingSkins.delete(skin)
    throw error
  })
  loadingSkins.set(skin, loading)
  return loading
}
