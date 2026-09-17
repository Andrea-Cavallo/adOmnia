import { BugHuntAudio } from './audio'
import { BUG_HUNT_COPY, type BugHuntCopy } from './copy'
import { LEVELS, BOSS_BODY, createBoss, firewallPhase, type Platform, CHECKPOINT_X, EXIT_X, HOTFIX, WORLD_WIDTH, createBugs, intersects, type Bug, type Rect } from './level'
import { renderLocalhost, type Particle, type PlayerVisual, type Popup } from './visuals'

export const WIDTH = 960
export const HEIGHT = 540
const STEP = 1 / 60
const GRAVITY = 1900
const RUN_SPEED = 310
const JUMP_SPEED = 680
type Player = PlayerVisual & { coyote: number; buffer: number; knockback: number; airJump: boolean; dash: number; dashCooldown: number; dashDirection: number }
export type GameSnapshot = {
  score: number; combo: number; bestCombo: number; dashReady: boolean; health: number; deaths: number; checkpoint: boolean; finished: boolean; paused: boolean
  level: number; levelComplete: boolean; bossHealth: number; bits: number; totalBits: number; hotfix: boolean; secret: boolean; bugs: number; seconds: number
}
export const INITIAL_SNAPSHOT: GameSnapshot = {
  score: 0, combo: 0, bestCombo: 0, dashReady: true, health: 3, deaths: 0, checkpoint: false, finished: false, paused: false,
  level: 0, levelComplete: false, bossHealth: 3, bits: 0, totalBits: LEVELS.reduce((n, l) => n + l.bits.length, 0), hotfix: false, secret: false, bugs: 0, seconds: 0,
}

export class BugHuntPrototype {
  private score = 0
  private chain = 0
  private bestCombo = 0
  private comboTime = 0
  private springCooldown = 0
  private level = 0
  private levelComplete = false
  private platforms: Platform[] = LEVELS[0].platforms.map(p => ({ ...p, originX: p.x, crumble: 0 }))
  private boss = createBoss()
  private get checkpointX() { return this.level === 2 ? 2500 : CHECKPOINT_X }
  private get map() { return LEVELS[this.level] }
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
    return { x, y: 412, w: 34, h: 48, vx: 0, vy: 0, grounded: true, coyote: 0.1, buffer: 0, invulnerable: 0, facing: 1, squash: 0, knockback: 0, airJump: true, dash: 0, dashCooldown: 0, dashDirection: 1 }
  }

  getSnapshot(): GameSnapshot {
    return { score: this.score, combo: this.chain, bestCombo: this.bestCombo, dashReady: this.player.dashCooldown <= 0, health: this.health, deaths: this.deaths, checkpoint: this.checkpoint, finished: this.finished, paused: this.paused,
      level: this.level, levelComplete: this.levelComplete, bossHealth: this.boss.health, bits: this.collected.size, totalBits: LEVELS.reduce((n, l) => n + l.bits.length, 0), hotfix: this.hotfix, secret: this.secret, bugs: this.defeated.size, seconds: this.elapsed }
  }

  private publish() { this.onChange(this.getSnapshot()) }

  unlockAudio() { this.audio.unlock() }
  setAudio(enabled: boolean) { this.audio.setEnabled(enabled) }
  setCopy(copy: BugHuntCopy) { this.copy = copy; if (this.paused) this.draw() }
  setReducedMotion(enabled: boolean) { this.reducedMotion = enabled; this.shake = 0; if (this.paused) this.draw() }

  keyDown(code: string) {
    if (this.paused || this.finished || this.levelComplete) return
    if (['KeyX', 'ShiftLeft', 'ShiftRight'].includes(code) && !this.keys.has(code) && this.player.dashCooldown <= 0 && this.player.knockback <= 0) {
      const p = this.player
      p.dash = 0.18; p.dashCooldown = 0.85
      p.dashDirection = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) || p.facing
      p.facing = p.dashDirection; p.vy = 0
      this.burst(p.x + 17, p.y + 24, ['#82ffec', '#be8cff'], 16, 190)
      this.audio.play('dash'); this.publish()
    }
    if (code === 'Space' && !this.keys.has(code)) this.player.buffer = 0.12
    this.keys.add(code)
  }

  keyUp(code: string) {
    this.keys.delete(code)
    if (code === 'Space' && this.player.vy < -180) this.player.vy *= 0.52
  }

  clearKeys() { this.keys.clear(); this.player.buffer = 0; this.player.dash = 0 }

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

  advance() {
    if (!this.levelComplete || this.level >= LEVELS.length - 1) return
    this.chain = 0; this.comboTime = 0; this.springCooldown = 0
    this.level++
    this.levelComplete = false
    this.checkpoint = false; this.hotfix = false; this.health = 3
    this.enemies = this.map.bugs.map(b => ({ ...b }))
    this.platforms = this.map.platforms.map(p => ({ ...p, originX: p.x, crumble: 0 }))
    this.boss = createBoss()
    this.player = this.makePlayer(58); this.camera = 0
    this.particles = []; this.popups = []; this.clearKeys()
    this.visualTime = 0; this.lastTime = null; this.accumulator = 0
    this.setPaused(false); this.publish()
  }

  restart() {
    this.score = 0; this.chain = 0; this.bestCombo = 0; this.comboTime = 0; this.springCooldown = 0
    this.level = 0; this.levelComplete = false; this.boss = createBoss()
    this.platforms = this.map.platforms.map(p => ({ ...p, originX: p.x, crumble: 0 }))
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

  private reward(points: number, x: number, y: number) {
    this.chain++; this.comboTime = 3.5
    this.bestCombo = Math.max(this.bestCombo, this.chain)
    const multiplier = Math.min(5, 1 + Math.floor(this.chain / 4))
    this.score += points * multiplier
    if (this.chain % 4 === 0) {
      this.popup(`COMBO x${multiplier}  +${points * multiplier}`, x, y - 24, '#92ffe2')
      this.audio.play('combo', multiplier)
    }
  }

  private hurt(fell = false) {
    if ((!fell && this.player.invulnerable > 0) || this.finished) return
    this.chain = 0; this.comboTime = 0; this.player.dash = 0
    this.health--
    this.audio.play('hurt')
    this.burst(this.player.x + 17, Math.min(480, this.player.y + 24), ['#ff8f9f', '#c778e8', '#f1c7fc'], 22)
    this.shake = 4
    const died = this.health <= 0
    if (died) { this.deaths++; this.health = 3; this.enemies = this.map.bugs.map(b => ({ ...b })) }
    if (fell || died) {
      this.boss = createBoss()
      for (const platform of this.platforms) platform.crumble = 0
      this.player = this.makePlayer(this.checkpoint ? this.checkpointX : 58)
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
    for (const bit of this.map.bits) {
      if (this.collected.has(bit.id) || !intersects(rect, { x: bit.x - 19, y: bit.y - 20, w: 38, h: 40 })) continue
      this.collected.add(bit.id)
      this.reward(10, bit.x, bit.y)
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
    if (this.finished || this.levelComplete) return
    if (this.comboTime > 0) {
      this.comboTime = Math.max(0, this.comboTime - dt)
      if (this.comboTime === 0) { this.chain = 0; this.publish() }
    }
    this.springCooldown = Math.max(0, this.springCooldown - dt)
    this.elapsed += dt
    if (Math.floor(this.elapsed) !== this.publishedSecond) { this.publishedSecond = Math.floor(this.elapsed); this.publish() }
    const p = this.player
    for (const platform of this.platforms) {
      const oldX = platform.x
      if (platform.travel) platform.x = platform.originX! + Math.sin(this.visualTime * 1.5) * platform.travel
      if (p.grounded && Math.abs(p.y + p.h - platform.y) < 1 && p.x + p.w > oldX && p.x < oldX + platform.w) {
        p.x += platform.x - oldX
        if (platform.unstable && !platform.crumble) platform.crumble = 0.001
      }
      if (platform.crumble) {
        platform.crumble += dt
        if (platform.crumble > 3.5) platform.crumble = 0
      }
    }
    const wasGrounded = p.grounded
    if (p.grounded) p.airJump = true
    const dashWasReady = p.dashCooldown <= 0
    p.dashCooldown = Math.max(0, p.dashCooldown - dt)
    if (!dashWasReady && p.dashCooldown === 0) this.publish()
    p.dash = Math.max(0, p.dash - dt)
    p.invulnerable = Math.max(0, p.invulnerable - dt)
    p.squash *= Math.exp(-dt * 14)
    p.coyote = p.grounded ? 0.1 : Math.max(0, p.coyote - dt)
    p.buffer = Math.max(0, p.buffer - dt)
    const horizontal = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'))
    if (p.dash > 0) { p.vx = p.dashDirection * 720; p.vy = 0 }
    else if (p.knockback > 0) p.knockback -= dt
    else {
      const target = horizontal * RUN_SPEED
      const acceleration = (horizontal ? 2800 : 3400) * dt
      p.vx += Math.max(-acceleration, Math.min(acceleration, target - p.vx))
    }
    if (horizontal && p.dash <= 0) p.facing = horizontal
    if (p.buffer > 0 && (p.coyote > 0 || p.airJump) && p.dash <= 0) {
      const doubleJump = p.coyote <= 0
      if (doubleJump) { p.airJump = false; this.burst(p.x + 17, p.y + p.h, ['#8cf7ec', '#ffffff'], 18, 150) }
      p.vy = -JUMP_SPEED * (this.keys.has('Space') ? 1 : 0.67)
      p.grounded = false; p.coyote = 0; p.buffer = 0; p.squash = -0.12
      this.burst(p.x + 17, p.y + p.h, ['#b797e5', '#80ced9'], 9, 80)
      this.audio.play('jump')
    }
    const previousLeft = p.x, previousRight = p.x + p.w
    p.x = Math.max(0, Math.min(WORLD_WIDTH - p.w, p.x + p.vx * dt))
    for (const platform of this.platforms) {
      if ((platform.crumble ?? 0) > 0.8) continue
      if (platform.floating) continue
      if (!intersects(p, platform)) continue
      if (p.vx > 0 && previousRight <= platform.x) p.x = platform.x - p.w
      else if (p.vx < 0 && previousLeft >= platform.x + platform.w) p.x = platform.x + platform.w
    }
    const previousBottom = p.y + p.h, previousTop = p.y
    p.vy = p.dash > 0 ? 0 : Math.min(1000, p.vy + GRAVITY * dt)
    p.y += p.vy * dt
    p.grounded = false
    for (const platform of this.platforms) {
      if ((platform.crumble ?? 0) > 0.8) continue
      if (!intersects(p, platform)) continue
      if (p.vy >= 0 && previousBottom <= platform.y + 0.01) {
        p.y = platform.y - p.h
        if (!wasGrounded && p.vy > 160) {
          p.squash = 0.17
          this.burst(p.x + 17, platform.y - 1, ['#b797e5', '#80ced9'], 7, 65)
          this.audio.play('land')
        }
        p.vy = 0; p.grounded = true; p.airJump = true
      } else if (!platform.floating && p.vy < 0 && previousTop >= platform.y + platform.h - 0.01) {
        p.y = platform.y + platform.h; p.vy = 0
      }
    }
    for (const spring of this.map.springs) {
      if (this.springCooldown <= 0 && p.vy >= 0 && previousBottom <= spring.y + 14 && intersects(p, spring)) {
        p.y = spring.y - p.h; p.vy = -850; p.grounded = false; p.coyote = 0; p.airJump = true; p.dash = 0
        this.springCooldown = 0.35; p.squash = -0.2
        this.burst(p.x + 17, spring.y, ['#afffe1', '#dfb4ff'], 24, 190)
        this.audio.play('spring')
      }
    }
    if (p.dash > 0 && !this.reducedMotion) this.burst(p.x + 17, p.y + 28, ['#7afce0', '#c394ff'], 2, 15)
    if (p.y > HEIGHT + 70) { this.hurt(true); return }
    if (p.grounded && Math.abs(p.vx) > 90 && this.elapsed - this.lastDust > 0.1) {
      this.lastDust = this.elapsed
      this.burst(p.x + 17 - p.facing * 12, p.y + p.h - 2, ['#9175bd', '#73bdca'], 2, 32)
    }
    for (let index = 0; index < this.enemies.length; index++) {
      const bug = this.enemies[index]
      if (!bug.alive) continue
      if (bug.retry) bug.y = 426 - Math.max(0, Math.sin(this.visualTime * 3 + bug.phase)) * 74
      bug.x += bug.direction * 82 * dt
      if (bug.x <= bug.left) { bug.x = bug.left; bug.direction = 1 }
      if (bug.x >= bug.right) { bug.x = bug.right; bug.direction = -1 }
      if (!intersects(p, bug)) continue
      if (p.dash > 0 || (p.vy > 80 && previousBottom <= bug.y + 8)) {
        const id = this.level * 100 + index
        if (!this.defeated.has(id)) this.reward(100, bug.x, bug.y)
        bug.alive = false; this.defeated.add(id)
        if (p.dash <= 0) { p.y = bug.y - p.h; p.vy = this.keys.has('Space') ? -540 : -390 }
        p.airJump = true; p.squash = -0.1
        this.shake = 2.4
        this.burst(bug.x + 19, bug.y + 15, ['#ff8d9e', '#ffc6b8', '#b28fe7'], 24, 165)
        this.popup(this.copy.bugClosed[index], bug.x + 20, bug.y - 25, '#ffd4d2')
        this.audio.play('stomp'); this.publish()
      } else { this.hurt(); if (this.player !== p) return }
    }
    for (const spike of this.map.spikes) if (intersects(p, spike)) { this.hurt(); if (this.player !== p) return }
    for (const wall of this.map.firewalls) {
      if (firewallPhase(this.visualTime, wall.phase) === 'active' && p.dash <= 0 && intersects(p, wall)) {
        this.hurt(); if (this.player !== p) return
      }
    }
    if (this.level === 2 && this.boss.health > 0 && p.x > 2450) {
      const boss = this.boss
      const before = boss.clock
      boss.clock += dt
      if (before < 1.3 && boss.clock >= 1.3) {
        boss.waves.push({ x: BOSS_BODY.x, y: 436, w: 34, h: 24 })
        this.burst(BOSS_BODY.x, 452, ['#ffb56b', '#ff668c'], 22)
        this.audio.play('hurt')
      }
      if (boss.clock > 4.8) { boss.clock = 0; boss.hit = false }
      for (const wave of boss.waves) {
        wave.x -= dt * 250
        if (intersects(p, wave)) { this.hurt(); if (this.player !== p) return }
      }
      boss.waves = boss.waves.filter(w => w.x > 2140)
      if (intersects(p, BOSS_BODY)) {
        if (boss.clock >= 2 && !boss.hit && p.vy > 80 && previousBottom <= BOSS_BODY.y + 10) {
          boss.health--; boss.hit = true
          p.y = BOSS_BODY.y - p.h; p.vy = -540; p.invulnerable = 0.6
          this.burst(BOSS_BODY.x + 45, BOSS_BODY.y, ['#a6ffe3', '#e8cbff'], 40)
          this.audio.play(boss.health ? 'stomp' : 'win'); this.publish()
          if (!boss.health) { boss.waves = []; this.popup(this.copy.bossDefeated, BOSS_BODY.x, 290) }
        } else { this.hurt(); if (this.player !== p) return }
      }
    }
    if (!this.checkpoint && p.x + p.w > this.checkpointX && p.x < this.checkpointX + 40 && p.y < 460) {
      this.checkpoint = true
      this.burst(this.checkpointX + 13, 417, ['#a3ffe2', '#5ccfae', '#d7c0ff'], 28, 160)
      this.popup(this.copy.commitSaved, this.checkpointX + 30, 367, '#acffe0')
      this.audio.play('checkpoint'); this.publish()
    }
    this.collect(p)
    if (p.x + p.w > EXIT_X - 25) {
      if (this.hotfix && (this.level !== 2 || this.boss.health === 0)) {
        this.finished = this.level === LEVELS.length - 1; this.levelComplete = !this.finished; this.clearKeys()
        this.burst(EXIT_X, 385, ['#f5d77c', '#88f1d0', '#be8dff', '#ff9dad'], 70, 270)
        this.audio.play('win'); this.publish()
      } else {
        p.x = EXIT_X - 25 - p.w
        if (this.elapsed - this.lastGateHint > 3) {
          this.lastGateHint = this.elapsed
          this.popup(this.hotfix ? this.copy.bossLocked : this.copy.missingHotfix, EXIT_X - 75, 347, '#e6c0ff')
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
    renderLocalhost(this.ctx, { level: this.level, platforms: this.platforms, boss: this.boss, player: this.player, enemies: this.enemies, camera: this.camera, time: this.visualTime,
      collected: this.collected, particles: this.particles, popups: this.popups, checkpoint: this.checkpoint, hotfix: this.hotfix,
      secret: this.secret, shake: this.shake, reducedMotion: this.reducedMotion, finished: this.finished, copy: this.copy })
  }
}
