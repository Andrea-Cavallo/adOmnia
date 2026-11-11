export const LEVEL_REGION_LENGTH = 900
export const LEVEL_BLEND_LENGTH = 140
export const LEVEL_CHUNK = 150
export const LEVEL_SAFE_START = 260

export const LEVEL_REGIONS = [
  { id: 'cemetery', label: 'The Moonlit Cemetery' },
  { id: 'forest', label: 'The Hollow Woods' },
  { id: 'abbey', label: 'The Fallen Abbey' },
] as const

export function levelRegionAt(x: number) {
  const region = Math.max(0, Math.floor(x / LEVEL_REGION_LENGTH))
  const index = region % LEVEL_REGIONS.length
  const within = Math.max(0, x) % LEVEL_REGION_LENGTH
  return { ...LEVEL_REGIONS[index], index, next: (index + 1) % LEVEL_REGIONS.length, blend: Math.max(0, (within - LEVEL_REGION_LENGTH + LEVEL_BLEND_LENGTH) / LEVEL_BLEND_LENGTH) }
}

/** Shared by the terrain, pickups and enemies so every object rests on the same surface. */
export function levelElevationAt(x: number): number {
  if (x <= LEVEL_SAFE_START) return 0
  const heights = [0, -32, -32, 12, 12, -20, 0, 18, 0, -36, -12, 0]
  const position = (x - LEVEL_SAFE_START) / LEVEL_CHUNK
  const chunk = Math.floor(position)
  const start = heights[chunk % heights.length]
  const end = heights[(chunk + 1) % heights.length]
  return start + (end - start) * (position - chunk)
}
