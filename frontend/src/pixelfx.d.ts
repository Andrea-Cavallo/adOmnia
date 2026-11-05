// pixelfx ships plain JavaScript: only what the Hub game uses is typed here.
declare module 'pixelfx' {
  export interface PixelFrame {
    w: number
    h: number
    color: Uint32Array
    light: Uint32Array
  }
  export interface PixelFxOptions {
    x?: number
    y?: number
    flip?: boolean
    seed?: number
    /** A dark-to-bright ramp that recolors the effect. */
    palette?: string[]
  }
  export interface PixelFx {
    options: PixelFxOptions
    update(dt: number): void
    draw(frame: PixelFrame, layer?: 'back' | 'front'): void
    done(): boolean
  }
  export interface PixelAct {
    /** How far to throw the picture this frame: the impact's screen shake. */
    shake: [number, number]
    update(dt: number): void
    draw(frame: PixelFrame, parts?: { body?: boolean; target?: boolean }): void
    done(): boolean
  }
  export interface PixelPainter {
    text(text: string, x: number, y: number, color: number, options?: { font?: 'mini' | 'big'; scale?: number; align?: 'center' | 'right'; outline?: number; a?: number }): void
  }
  export type PixelFxModule = Record<string, unknown>
  export function createFrame(width: number, height: number): PixelFrame
  export function clearFrame(frame: PixelFrame): PixelFrame
  export function createFx(effect: PixelFxModule, options?: PixelFxOptions): PixelFx
  export function createAct(effect: PixelFxModule, options?: PixelFxOptions): PixelAct
  export function painterFor(frame: PixelFrame): PixelPainter
  export function actTiming(effect: PixelFxModule): { windup: number; recovery: number; hits: Array<{ t: number }> } | null
  export function composite(frame: PixelFrame, out: Uint8ClampedArray): Uint8ClampedArray
}

declare module 'pixelfx/fx/*' {
  export const meta: Record<string, unknown>
}
