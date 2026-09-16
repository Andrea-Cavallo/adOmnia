import { BugHuntAudio } from './audio'
import { BUG_HUNT_COPY, type BugHuntCopy } from './copy'
import { BITS, CHECKPOINT_X, EXIT_X, HOTFIX, PLATFORMS, SPIKES, WORLD_WIDTH, createBugs, intersects, type Bug, type Rect } from './level'
import { renderLocalhost, type Particle, type PlayerVisual, type Popup } from './visuals'

export const WIDTH = 960
export const HEIGHT = 540
const STEP = 1 / 60
const GRAVITY = 1900
const RUN_SPEED = 310
const JUMP_SPEED = 680
type Player = PlayerVisual & { coyote: number; buffer: number; knockback: number }
export type GameSnapshot = {
  health: number; deaths: number; checkpoint: boolean; finished: boolean; paused: boolean
  bits: number; totalBits: number; hotfix: boolean; secret: boolean; bugs: number; seconds: number
}
export const INITIAL_SNAPSHOT: GameSnapshot = {
  health: 3, deaths: 0, checkpoint: false, finished: false, paused: false,
  bits: 0, totalBits: BITS.length, hotfix: false, secret: false, bugs: 0, seconds: 0,
}

export class BugHuntPrototype {
  private ctx: CanvasRenderingContext2D
  private player: Player
  private enemies: Bug[] = createBugs()
  private keys = new Set<string>()
  private collected = new Set<number>()
  private defeated = new Set<number>()
  private particles: Particle[] = []
  private popups: Popup[] = []
  private audio = new BugHuntAudio()
  private checkpoint = false
  private hotfix = false
  private secret = false
  private health = 3
  private deaths = 0
  private finished = false
  private paused = false
  private destroyed = false
  private camera = 0
  private elapsed = 0
  private visualTime = 0
  private lastTime: number | null = null
  private accumulator = 0
  private frame = 0
  private shake = 0
  private reducedMotion = false
  private lastDust = 0
  private lastGateHint = -10
  private publishedSecond = 0
  private copy: BugHuntCopy

  constructor(canvas: HTMLCanvasElement, private onChange: (snapshot: GameSnapshot) => void, options: { audio?: boolean; reducedMotion?: boolean; copy?: BugHuntCopy } = {}) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.ctx = ctx
    this.audio.enabled = options.audio ?? true
    this.reducedMotion = options.reducedMotion ?? false
    this.copy = options.copy ?? BUG_HUNT_COPY.en
    this.player = this.makePlayer(58)
    this.publish()
    this.frame = requestAnimationFrame(this.loop)
  }

  private makePlayer(x: number): Player {
    return { x, y: 412, w: 34, h: 48, vx: 0, vy: 0, grounded: true, coyote: 0.1, buffer: 0, invulnerable: 0, facing: 1, squash: 0, knockback: 0 }
  }

  getSnapshot(): GameSnapshot {
    return { health: this.health, deaths: this.deaths, checkpoint: this.checkpoint, finished: this.finished, paused: this.paused,
      bits: this.collected.size, totalBits: BITS.length, hotfix: this.hotfix, secret: this.secret, bugs: this.defeated.size, seconds: this.elapsed }
  }

  private publish() { this.onChange(this.getSnapshot()) }

  unlockAudio() { this.audio.unlock() }
  setAudio(enabled: boolean) { this.audio.setEnabled(enabled) }
  setCopy(copy: BugHuntCopy) { this.copy = copy; if (this.paused) this.draw() }
  setReducedMotion(enabled: boolean) { this.reducedMotion = enabled; this.shake = 0; if (this.paused) this.draw() }

  keyDown(code: string) {
    if (this.paused || this.finished) return
    if (code === 'Space' && !this.keys.has(code)) this.player.buffer = 0.12
    this.keys.add(code)
  }

  keyUp(code: string) {
    this.keys.delete(code)
    if (code === 'Space' && this.player.vy < -180) this.player.vy *= 0.52
  }

  clearKeys() { this.keys.clear(); this.player.buffer = 0 }

  setPaused(paused: boolean) {
    if (this.destroyed || this.paused === paused) return
    this.paused = paused
    this.clearKeys()
    this.accumulator = 0
    this.lastTime = null
    cancelAnimationFrame(this.frame)
    if (paused) { this.audio.stop(); this.draw() }
    else this.frame = requestAnimationFrame(this.loop)
    this.publish()
  }

  restart() {
    this.health = 3; this.deaths = 0; this.checkpoint = false; this.finished = false; this.hotfix = false; this.secret = false
    this.enemies = createBugs()
    this.collected.clear(); this.defeated.clear(); this.particles = []; this.popups = []
    this.player = this.makePlayer(58)
    this.camera = 0; this.elapsed = 0; this.visualTime = 0; this.shake = 0; this.lastDust = 0; this.lastGateHint = -10; this.publishedSecond = 0
    this.audio.stop()
    this.clearKeys()
    if (this.paused) this.setPaused(false)
    this.publish()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.frame)
    this.clearKeys()
    this.audio.destroy()
  }

  private burst(x: number, y: number, colors: string[], count = 14, force = 140) {
    const total = this.reducedMotion ? Math.ceil(count / 3) : count
    for (let i = 0; i < total && this.particles.length < 180; i++) {
      const angle = i * 2.39996 + this.visualTime
      const speed = force * (0.4 + (i % 5) / 6)
      const life = 0.3 + (i % 7) * 0.08
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, life, maxLife: life, color: colors[i % colors.length], size: 2 + i % 3, gravity: 240 })
    }
  }

  private popup(text: string, x: number, y: number, color = '#e7d4ff') {
    this.popups = this.popups.slice(-5)
    this.popups.push({ text, x, y, color, life: 1.5 })
  }

  private hurt(fell = false) {
    if ((!fell && this.player.invulnerable > 0) || this.finished) return
    this.health--
    this.audio.play('hurt')
    this.burst(this.player.x + 17, Math.min(480, this.player.y + 24), ['#ff8f9f', '#c778e8', '#f1c7fc'], 22)
    this.shake = 4
    const died = this.health <= 0
    if (died) { this.deaths++; this.health = 3; this.enemies = createBugs() }
    if (fell || died) {
      this.player = this.makePlayer(this.checkpoint ? CHECKPOINT_X : 58)
      this.camera = Math.max(0, Math.min(WORLD_WIDTH - WIDTH, this.player.x - 310))
      this.popup(died ? this.copy.retry : this.copy.rollback, this.player.x + 65, this.player.y - 20)
    } else {
      this.player.vx = -this.player.facing * 220
      this.player.vy = -270
      this.player.grounded = false
      this.player.coyote = 0
      this.player.knockback = 0.23
      this.popup(this.copy.notAFeature, this.player.x + 17, this.player.y - 15, '#ffb4c0')
    }
    this.player.invulnerable = 1.2
    this.publish()
  }

  private collect(rect: Rect) {
    for (const bit of BITS) {
      if (this.collected.has(bit.id) || !intersects(rect, { x: bit.x - 11, y: bit.y - 12, w: 22, h: 24 })) continue
      this.collected.add(bit.id)
      this.burst(bit.x, bit.y, ['#fff1bf', '#eac15e', '#bb86e9'], 9, 95)
      this.audio.play('bit', this.collected.size)
      if (bit.secret && !this.secret) {
        this.secret = true
        this.popup(this.copy.secretFound, bit.x + 50, bit.y - 30, '#e2b6ff')
        this.audio.play('secret')
      }
      if (this.collected.size % 5 === 0) this.popup(this.copy.bits(this.collected.size), bit.x, bit.y - 15, '#ffe4a0')
      this.publish()
    }
    if (!this.hotfix && intersects(rect, HOTFIX)) {
      this.hotfix = true
      this.burst(HOTFIX.x + 15, HOTFIX.y + 17, ['#b9ffe9', '#5fe5c0', '#d6b3ff'], 34, 180)
      this.audio.play('hotfix')
      this.popup(this.copy.hotfixPickup, HOTFIX.x, HOTFIX.y - 28, '#abffe2')
      this.publish()
    }
  }

  private update(dt: number) {
    if (this.paused) return
    this.visualTime += dt
    this.shake = Math.max(0, this.shake - dt * 18)
    for (const particle of this.particles) {
      particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += particle.gravity * dt
    }
    this.particles = this.particles.filter((particle) => particle.life > 0)
    for (const popup of this.popups) { popup.life -= dt; popup.y -= dt * 20 }
    this.popups = this.popups.filter((popup) => popup.life > 0)
    if (this.finished) return
    this.elapsed += dt
    if (Math.floor(this.elapsed) !== this.publishedSecond) { this.publishedSecond = Math.floor(this.elapsed); this.publish() }
    const p = this.player
    const wasGrounded = p.grounded
    p.invulnerable = Math.max(0, p.invulnerable - dt)
    p.squash *= Math.exp(-dt * 14)
    p.coyote = p.grounded ? 0.1 : Math.max(0, p.coyote - dt)
    p.buffer = Math.max(0, p.buffer - dt)
    const horizontal = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'))
    if (p.knockback > 0) p.knockback -= dt
    else {
      const target = horizontal * RUN_SPEED
      const acceleration = (horizontal ? 2800 : 3400) * dt
      p.vx += Math.max(-acceleration, Math.min(acceleration, target - p.vx))
    }
    if (horizontal) p.facing = horizontal
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = -JUMP_SPEED * (this.keys.has('Space') ? 1 : 0.67)
      p.grounded = false; p.coyote = 0; p.buffer = 0; p.squash = -0.12
      this.burst(p.x + 17, p.y + p.h, ['#b797e5', '#80ced9'], 9, 80)
      this.audio.play('jump')
    }
    const previousLeft = p.x, previousRight = p.x + p.w
    p.x = Math.max(0, Math.min(WORLD_WIDTH - p.w, p.x + p.vx * dt))
    for (const platform of PLATFORMS) {
      if (platform.floating) continue
      if (!intersects(p, platform)) continue
      if (p.vx > 0 && previousRight <= platform.x) p.x = platform.x - p.w
      else if (p.vx < 0 && previousLeft >= platform.x + platform.w) p.x = platform.x + platform.w
    }
    const previousBottom = p.y + p.h, previousTop = p.y
    p.vy = Math.min(1000, p.vy + GRAVITY * dt)
    p.y += p.vy * dt
    p.grounded = false
    for (const platform of PLATFORMS) {
      if (!intersects(p, platform)) continue
      if (p.vy >= 0 && previousBottom <= platform.y + 0.01) {
        p.y = platform.y - p.h
        if (!wasGrounded && p.vy > 160) {
          p.squash = 0.17
          this.burst(p.x + 17, platform.y - 1, ['#b797e5', '#80ced9'], 7, 65)
          this.audio.play('land')
        }
        p.vy = 0; p.grounded = true
      } else if (!platform.floating && p.vy < 0 && previousTop >= platform.y + platform.h - 0.01) {
        p.y = platform.y + platform.h; p.vy = 0
      }
    }
    if (p.y > HEIGHT + 70) { this.hurt(true); return }
    if (p.grounded && Math.abs(p.vx) > 90 && this.elapsed - this.lastDust > 0.1) {
      this.lastDust = this.elapsed
      this.burst(p.x + 17 - p.facing * 12, p.y + p.h - 2, ['#9175bd', '#73bdca'], 2, 32)
    }
    for (let index = 0; index < this.enemies.length; index++) {
      const bug = this.enemies[index]
      if (!bug.alive) continue
      bug.x += bug.direction * 82 * dt
      if (bug.x <= bug.left) { bug.x = bug.left; bug.direction = 1 }
      if (bug.x >= bug.right) { bug.x = bug.right; bug.direction = -1 }
      if (!intersects(p, bug)) continue
      if (p.vy > 80 && previousBottom <= bug.y + 8) {
        bug.alive = false; this.defeated.add(index)
        p.y = bug.y - p.h; p.vy = this.keys.has('Space') ? -540 : -390; p.squash = -0.1
        this.shake = 2.4
        this.burst(bug.x + 19, bug.y + 15, ['#ff8d9e', '#ffc6b8', '#b28fe7'], 24, 165)
        this.popup(this.copy.bugClosed[index], bug.x + 20, bug.y - 25, '#ffd4d2')
        this.audio.play('stomp'); this.publish()
      } else { this.hurt(); if (this.player !== p) return }
    }
    for (const spike of SPIKES) if (intersects(p, spike)) { this.hurt(); if (this.player !== p) return }
    if (!this.checkpoint && p.x + p.w > CHECKPOINT_X && p.x < CHECKPOINT_X + 40 && p.y < 460) {
      this.checkpoint = true
      this.burst(CHECKPOINT_X + 13, 417, ['#a3ffe2', '#5ccfae', '#d7c0ff'], 28, 160)
      this.popup(this.copy.commitSaved, CHECKPOINT_X + 30, 367, '#acffe0')
      this.audio.play('checkpoint'); this.publish()
    }
    this.collect(p)
    if (p.x + p.w > EXIT_X - 25) {
      if (this.hotfix) {
        this.finished = true; this.clearKeys()
        this.burst(EXIT_X, 385, ['#f5d77c', '#88f1d0', '#be8dff', '#ff9dad'], 70, 270)
        this.audio.play('win'); this.publish()
      } else {
        p.x = EXIT_X - 25 - p.w
        if (this.elapsed - this.lastGateHint > 3) {
          this.lastGateHint = this.elapsed
          this.popup(this.copy.missingHotfix, EXIT_X - 75, 347, '#e6c0ff')
        }
      }
    }
    const target = Math.max(0, Math.min(WORLD_WIDTH - WIDTH, p.x - 310))
    this.camera += (target - this.camera) * Math.min(1, dt * 8)
  }

  private loop = (time: number) => {
    if (this.destroyed || this.paused) return
    if (this.lastTime !== null) {
      this.accumulator += Math.min(0.1, (time - this.lastTime) / 1000)
      while (this.accumulator + 1e-9 >= STEP) { this.update(STEP); this.accumulator -= STEP }
    }
    this.lastTime = time
    this.draw()
    this.frame = requestAnimationFrame(this.loop)
  }

  private draw() {
    renderLocalhost(this.ctx, { player: this.player, enemies: this.enemies, camera: this.camera, time: this.visualTime,
      collected: this.collected, particles: this.particles, popups: this.popups, checkpoint: this.checkpoint, hotfix: this.hotfix,
      secret: this.secret, shake: this.shake, reducedMotion: this.reducedMotion, finished: this.finished, copy: this.copy })
  }
}
