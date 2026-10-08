import { accentTokens, contrast, luminance, validAccent } from './accentPalette'

export interface PersonalColors {
  themeId: string
  accentColor?: string
  baseColor?: string
}
export interface AppearanceProfile extends PersonalColors {
  id: string
  name: string
}

function mix(a: string, b: string, amount: number): string {
  return (
    '#' +
    [1, 3, 5]
      .map((i) => {
        const from = parseInt(a.slice(i, i + 2), 16),
          to = parseInt(b.slice(i, i + 2), 16)
        const value = from + (to - from) * amount
        return (to > from ? Math.ceil(value) : Math.floor(value))
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

/** Derive a complete surface/text hierarchy without changing semantic status colors. */
export function personalColors(
  themeColors: Record<string, string>,
  chosen: Pick<PersonalColors, 'accentColor' | 'baseColor'>,
  mode: 'dark' | 'light',
): Record<string, string> {
  const colors = { ...themeColors }
  if (validAccent(chosen.baseColor)) {
    const base = chosen.baseColor.toUpperCase()
    const foreground = luminance(base) > 0.179 ? '#000000' : '#FFFFFF'
    const dark = foreground === '#FFFFFF'
    const surfaces = [0, 0.025, 0.05, 0.075, 0.1].map((amount) => {
      let value = mix(base, foreground, amount)
      for (let i = 0; i < 50 && contrast(value, foreground) < 4.5; i++) {
        amount *= 0.5
        value = mix(base, foreground, amount)
      }
      return contrast(value, foreground) >= 4.5 ? value : base
    })
    surfaces.forEach((value, i) => {
      colors[`surface-${i}`] = value
    })
    const readable = (amount: number) => {
      let value = mix(foreground, base, amount)
      for (
        let i = 0;
        i < 50 && surfaces.some((s) => contrast(value, s) < 4.5);
        i++
      )
        value = mix(value, foreground, 0.15)
      return value
    }
    for (let i = 1; i <= 4; i++) colors[`text-${i}`] = readable((i - 1) * 0.14)
    for (let i = 1; i <= 3; i++)
      colors[`border-${i}`] = mix(base, foreground, 0.16 + i * 0.07)
    // Syntax tokens inherited from a theme must stay readable on the new base.
    const syntaxKeys = new Set([
      ...Object.keys(colors).filter((key) => key.startsWith('json-')),
      ...[
        'key',
        'string',
        'number',
        'bool',
        'null',
        'bracket-1',
        'bracket-2',
        'bracket-3',
      ].map((key) => `json-${key}`),
    ])
    for (const key of syntaxKeys) colors[key] = readable(0.14)
    mode = dark ? 'dark' : 'light'
  }
  const primary = validAccent(chosen.accentColor)
    ? chosen.accentColor
    : validAccent(chosen.baseColor)
      ? validAccent(colors.accent)
        ? colors.accent
        : mode === 'dark'
          ? '#FFFFFF'
          : '#000000'
      : undefined
  if (primary) {
    const surfaces = [0, 1, 2, 3, 4]
      .map((i) => colors[`surface-${i}`])
      .filter(validAccent)
    const toward =
      surfaces.length && luminance(surfaces[0]) > 0.179 ? '#000000' : '#FFFFFF'
    let value = primary
    for (
      let i = 0;
      i < 100 && surfaces.some((s) => contrast(value, s) < 4.5);
      i++
    )
      value = mix(value, toward, 0.08)
    Object.assign(colors, accentTokens(value, mode, colors['surface-1']))
  }
  return colors
}

export function normalizeProfiles(value: unknown): AppearanceProfile[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value
    .flatMap((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        !item.id ||
        item.id.length > 100 ||
        ids.has(item.id) ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        typeof item.themeId !== 'string' ||
        !item.themeId
      )
        return []
      ids.add(item.id)
      return [
        {
          id: item.id.slice(0, 100),
          name: item.name.trim().slice(0, 60),
          themeId: item.themeId,
          accentColor: validAccent(item.accentColor)
            ? item.accentColor
            : undefined,
          baseColor: validAccent(item.baseColor) ? item.baseColor : undefined,
        },
      ]
    })
    .slice(0, 50)
}
