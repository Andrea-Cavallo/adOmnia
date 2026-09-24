import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BugHuntPrototype } from './prototype'
import type { Bug, Platform } from './level'
import type { PlayerVisual, Shot } from './visuals'

type Harness = { player: PlayerVisual; platforms: Platform[]; enemies: Bug[]; shots: Shot[]; update(dt: number): void }
function create() {
  const game = new BugHuntPrototype({ getContext: () => ({}) } as unknown as HTMLCanvasElement, () => {})
  const state = game as unknown as Harness
  state.enemies = []; state.platforms = [{x:0,y:460,w:2000,h:100}]
  const tick = (n=1) => { for(let i=0;i<n;i++) state.update(1/60) }
  return {game, state, tick}
}
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
afterEach(() => vi.unstubAllGlobals())

describe('platform flow through real controls', () => {
  it('accelerates progressively, brakes promptly and reverses without sticking', () => {
    const {game,state,tick}=create()
    game.keyDown('KeyD'); tick(3)
    expect(state.player.vx).toBeGreaterThan(0); expect(state.player.vx).toBeLessThan(200)
    tick(15); expect(state.player.vx).toBe(330)
    game.keyUp('KeyD'); tick(9); expect(state.player.vx).toBe(0)
    game.keyDown('KeyD'); tick(12); game.keyUp('KeyD'); game.keyDown('KeyA'); tick(14)
    expect(state.player.vx).toBeLessThan(-250)
    game.destroy()
  })
  it('a tap jumps lower than a hold without consuming the air jump', () => {
    const height = (release: boolean) => {
      const {game,state,tick}=create(); game.keyDown('Space'); tick(3)
      if(release) game.keyUp('Space')
      let top=state.player.y
      for(let i=0;i<60;i++){tick();top=Math.min(top,state.player.y)}
      expect(game.getSnapshot().deaths).toBe(0); game.destroy(); return 412-top
    }
    expect(height(false)-height(true)).toBeGreaterThan(60)
  })
  it('slide-jump carries farther than a running jump while restoring the standing pose', () => {
    const distance = (slide: boolean) => {
      const {game,state,tick}=create(); game.keyDown('KeyD'); tick(12)
      if(slide){game.keyDown('KeyC'); tick(6); expect(state.player.h).toBe(26)}
      const x=state.player.x; game.keyDown('Space'); tick()
      expect(state.player.h).toBe(48)
      for(let i=0;i<90 && !state.player.grounded;i++)tick()
      const d=state.player.x-x
      expect(game.getSnapshot().health).toBe(3); game.destroy(); return d
    }
    expect(distance(true)-distance(false)).toBeGreaterThan(60)
  })
  it('slide is grounded, is not invulnerability and resets when controls are cleared', () => {
    const {game,state,tick}=create()
    game.keyDown('Space'); tick(5); game.keyDown('KeyC'); expect(state.player.slide ?? 0).toBe(0)
    game.keyUp('KeyC'); game.keyUp('Space'); tick(90)
    game.keyDown('KeyA'); game.keyDown('KeyC'); tick(); expect(state.player.slide).toBeGreaterThan(0)
    expect(state.player.vx).toBeLessThan(0)
    expect(state.player.dash).toBe(0); expect(state.player.invulnerable).toBe(0)
    game.clearKeys(); expect(state.player.slide).toBe(0)
    game.destroy()
  })
  it('held stomp rebounds to an upper route, tap stays low, neither needs a shot', () => {
    const rebound = (held: boolean) => {
      const {game,state,tick}=create()
      if(held) game.keyDown('Space')
      Object.assign(state.player,{x:300,y:350,vy:260,grounded:false,buffer:0,coyote:0})
      state.enemies=[{x:300,y:426,w:38,h:34,left:300,right:300,direction:1,alive:true,phase:0,kind:'patrol',hp:1}]
      for(let i=0;i<30 && state.enemies[0].alive;i++)tick()
      expect(state.enemies[0].alive).toBe(false)
      let top=state.player.y
      for(let i=0;i<35;i++){tick();top=Math.min(top,state.player.y)}
      expect(state.shots).toHaveLength(0); expect(game.getSnapshot().health).toBe(3)
      game.destroy(); return top
    }
    expect(rebound(false)-rebound(true)).toBeGreaterThan(80)
  })
  it('chains a held stomp into a higher platform without firing', () => {
    const {game,state,tick}=create()
    game.keyDown('Space')
    Object.assign(state.player,{x:300,y:350,vy:260,grounded:false,buffer:0,coyote:0})
    state.enemies=[{x:300,y:426,w:38,h:34,left:300,right:300,direction:1,alive:true,phase:0,kind:'patrol',hp:1}]
    state.platforms.push({x:400,y:320,w:180,h:22,floating:true})
    for(let i=0;i<30 && state.enemies[0].alive;i++)tick()
    game.keyDown('KeyD')
    let landed=false
    for(let i=0;i<80;i++) {
      if(state.player.x>445)game.keyUp('KeyD')
      tick()
      if(state.player.grounded && state.player.y+state.player.h===320){landed=true;break}
    }
    expect(landed).toBe(true); expect(state.shots).toHaveLength(0)
    expect(game.getSnapshot().health).toBe(3); game.destroy()
  })

})
