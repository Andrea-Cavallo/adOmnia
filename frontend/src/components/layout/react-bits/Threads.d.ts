import type { HTMLAttributes } from 'react'
type Color = string | [number, number, number]
export interface ThreadsProps extends HTMLAttributes<HTMLDivElement> {
  color?: Color
  accentColor?: Color
  amplitude?: number
  distance?: number
  enableMouseInteraction?: boolean
  lineCount?: number
  thickness?: number
  softness?: number
  speed?: number
  waves?: number
  split?: number
  fray?: number
  angle?: number
  seed?: number
  parting?: number
  taper?: number
  brightness?: number
  fade?: number
  opacity?: number
  paused?: boolean
}
export default function Threads(props: ThreadsProps): import('react').ReactElement
