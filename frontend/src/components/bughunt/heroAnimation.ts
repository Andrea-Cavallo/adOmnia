import type { PlayerVisual } from './visuals'

/** Cosmetic clocks live with the player: pause/restart never leave a renderer timer running. */
export function stepHeroAnimation(p: PlayerVisual, dt: number) {
  const speed = Math.min(1, Math.abs(p.vx) / 310)
  p.stride = ((p.stride ?? 0) + (p.grounded ? speed * dt * 15 : 0)) % (Math.PI * 2)
  p.idleTime = p.grounded && speed < .06 && !p.danger && !p.crouch && !(p.celebrate ?? 0) ? (p.idleTime ?? 0) + dt : 0
  p.recoil = Math.max(0, (p.recoil ?? 0) - dt * 7)
  const target = p.grounded ? p.vx / 310 * .065 : p.vx / 310 * .035
  p.lean = (p.lean ?? 0) + (target - (p.lean ?? 0)) * (1 - Math.exp(-dt * 12))
}

export function heroPose(p: PlayerVisual, reduced: boolean) {
  const speed = Math.min(1, Math.abs(p.vx) / 310), phase = p.stride ?? 0
  const idle = p.idleTime ?? 0
  // A curious head/body tilt every few seconds, only when the surroundings are safe.
  const curious = idle > 3 ? Math.sin(Math.min(1, Math.max(0, (idle % 7 - 3) / 2)) * Math.PI) : 0
  const celebration = Math.sin(Math.min(1, (p.celebrate ?? 0) / 1.2) * Math.PI)
  const bob = p.grounded ? -Math.abs(Math.sin(phase)) * speed * 2.5 : 0
  const stretch = p.grounded ? p.squash : Math.max(-.09, Math.min(.07, p.vy / 700 * .07))
  return {
    cell: (p.slide ?? 0) > 0 ? 1 : !p.grounded || celebration > .1 ? 3 : speed > .06 ? (Math.sin(phase) >= 0 ? 1 : 2) : 0,
    xScale: reduced ? 1 : 1 + stretch * .5,
    yScale: reduced ? 1 : 1 - stretch,
    rotation: reduced ? 0 : ((p.slide ?? 0) > 0 ? p.facing * .22 : (p.lean ?? 0)) + curious * p.facing * .065 + Math.sin((p.recover ?? 0) * 17) * (p.recover ?? 0) * .035,
    lift: reduced ? 0 : bob - celebration * 5 - Math.sin(idle * 2.4) * .55,
    recoil: reduced ? 0 : (p.recoil ?? 0) * 4,
    curious: reduced ? false : curious > .6,
  }
}
