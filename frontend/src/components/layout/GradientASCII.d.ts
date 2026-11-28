import type { CSSProperties, HTMLAttributes } from 'react'

export interface GradientASCIIProps extends HTMLAttributes<HTMLDivElement> {
  colors?: string[]
  shape?: 'horizon' | 'pinch' | 'rise' | 'eclipse'
  characters?: string
  cellSize?: number
  density?: number
  glyphOpacity?: number
  glow?: number
  depthOfField?: number
  flicker?: number
  softness?: number
  scale?: number
  flow?: number
  speed?: number
  gradientOpacity?: number
  grain?: number
  variation?: number
  mouseInteraction?: boolean
  scrambleRadius?: number
  clickEffect?: 'none' | 'wave' | 'burst'
  intro?: boolean
  lightMode?: boolean
  fontFamily?: string
  dpr?: number
  style?: CSSProperties
}

export default function GradientASCII(props: GradientASCIIProps): React.JSX.Element
