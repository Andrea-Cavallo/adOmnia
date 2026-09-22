import { livesFor, type Difficulty } from './difficulty'
import { stepSpecialBug } from './enemies'
import { createRush, RUSH_START, RUSH_END, RUSH_TARGET, RUSH_BONUS, type Rush } from './rush'
import { BugHuntAudio } from './audio'
import { BUG_HUNT_COPY, type BugHuntCopy } from './copy'
import { ARENA_X, BOSS_HEALTH, DEBRIS, BOSS_MODULES, bossPhase, GRAVITY_SAFE_X, COMMAND_SECONDS, platformOffline, BOSS_ANNOUNCE, BOSS_COMMANDS, BOSS_BODY, BOSS_FISTS, ENVELOPE_GRAVITY, ENVELOPE_SPEED, LEVELS, createBoss, firewallPhase, type Boss, type BossCommand, type Platform, CHECKPOINT_X, levelExit, levelHotfix, levelWidth, TURRET_CYCLE, intersects, type Bug, type Rect } from './level'
import { renderLocalhost, type Particle, type PlayerVisual, type Popup, type Shot } from './visuals'
import {
  BREAKPOINT_SECONDS, GC_RADIUS, GC_SPEED, PICKUP_SIZE, REVERT_MAX_CHARGES, REWIND_SPEED, SUDO_SECONDS,
  clearActivePowers, createPowerState, pickupKey, recordFrame, type PowerKind,
} from './powers'

export const WIDTH = 960
export const HEIGHT = 540
const STEP = 1 / 60
const GRAVITY = 1900
const RUN_SPEED = 310
const JUMP_SPEED = 680
/** Magnetic grapple: latch range, cable limits and the launch kick. */
const GRAPPLE_RANGE = 300
const GRAPPLE_MIN = 64
const GRAPPLE_REEL = 250
const GRAPPLE_LAUNCH = 250
export type PurgeState = 'off' | 'waiting' | 'active' | 'cleared'
/** a0 fires debug packets; turrets fire back. Both are slow enough to read. */
const PLAYER_H = 48
/** Crouch: shorter box, slower walk. Bolts aimed at the torso miss. */
const CROUCH_H = 26
const CROUCH_SPEED = 0.45
const SHOT_COOLDOWN = 0.22
const SHOT_SPEED = 640
const BOLT_SPEED = 250
const CHASE_RANGE = 320
const CHASE_SPEED = 196
const TURRET_RANGE = 430

type Player = PlayerVisual & { crouch: boolean; coyote: number; buffer: number; knockback: number; airJump: boolean; dash: number; dashCooldown: number; dashDirection: number }
export type GameSnapshot = {
  difficulty: Difficulty
  rush: Rush; rushWins: number; totalBugs: number; revertCharges: number; sudo: number; breakpoint: number
  score: number; combo: number; bestCombo: number; dashReady: boolean; health: number; gameOver: boolean; deaths: number; checkpoint: boolean; finished: boolean; paused: boolean
  grappled: boolean; purge: PurgeState; shotReady: boolean; bossCommand: BossCommand | null; bossAnnounce: boolean
  level: number; levelComplete: boolean; bossHealth: number; bits: number; totalBits: number; hotfix: boolean; secret: boolean; bugs: number; seconds: number
}
export const INITIAL_SNAPSHOT: GameSnapshot = {
  difficulty: 'production',
  rush: createRush(), rushWins: 0, totalBugs: LEVELS.reduce((sum, l) => sum + l.bugs.length, 0), revertCharges: 0, sudo: 0, breakpoint: 0,
  score: 0, combo: 0, bestCombo: 0, dashReady: true, health: 3, gameOver: false, deaths: 0, checkpoint: false, finished: false, paused: false,
  grappled: false, purge: 'off', shotReady: true, bossCommand: null, bossAnnounce: false,
  level: 0, levelComplete: false, bossHealth: BOSS_HEALTH, bits: 0, totalBits: LEVELS.reduce((n, l) => n + l.bits.length, 0), hotfix: false, secret: false, bugs: 0, seconds: 0,
}

export class BugHuntPrototype {
  private rush = createRush()
  private rushWins = 0
  private score = 0
  private powers = createPowerState()
  /** Advances only while no breakpoint is active: drives bugs, firewalls, moving platforms and the boss. */
  private worldTime = 0
  private publishedPowers = ''
  private chain = 0
  private bestCombo = 0
  private comboTime = 0
  private springCooldown = 0
  private purgeState: PurgeState = 'off'
  private purgeX = 0
  private shots: Shot[] = []
  private shotCooldown = 0
  /** -1 while the Monolith has gravity reversed inside its arena. */
  private gravitySign = 1
  private level = 0
  private levelComplete = false
  private platforms: Platform[] = LEVELS[0].platforms.map(p => ({ ...p, originX: p.x, originY: p.y, crumble: 0 }))
  private boss = createBoss()
  private bossRewards = new Set<number>()
  private lesson = { index: -1, announce: 0, remaining: 0, done: new Set<number>() }
  private slowRemaining = 0
  private slowUsed = false
  private get checkpointX() { return this.level === 2 ? 2500 : CHECKPOINT_X }
  private get map() { return LEVELS[this.level] }
  private ctx: CanvasRenderingContext2D
  private player: Player
  private enemies: Bug[] = LEVELS[0].bugs.map(b => ({ ...b }))
  private keys = new Set<string>()
  private collected = new Set<number>()
  private defeated = new Set<number>()
  private particles: Particle[] = []
  private popups: Popup[] = []
  private audio = new BugHuntAudio()
  private checkpoint = false
  private hotfix = false
  private secret = false
  private difficulty: Difficulty = 'production'
  private health = 3
  private gameOver = false
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

  constructor(canvas: HTMLCanvasElement, private onChange: (snapshot: GameSnapshot) => void, options: { difficulty?: Difficulty; audio?: boolean; reducedMotion?: boolean; copy?: BugHuntCopy } = {}) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.ctx = ctx
    this.difficulty = options.difficulty ?? 'production'
    this.health = livesFor(this.difficulty)
    this.audio.enabled = options.audio ?? true
    this.reducedMotion = options.reducedMotion ?? false
    this.copy = options.copy ?? BUG_HUNT_COPY.en
    this.player = this.makePlayer(58)
    this.resetPurge()
    this.publish()
    this.frame = requestAnimationFrame(this.loop)
  }

  private makePlayer(x: number): Player {
    return { x, y: 412, w: 34, h: PLAYER_H, crouch: false, vx: 0, vy: 0, grounded: true, coyote: 0.1, buffer: 0, invulnerable: 0, facing: 1, squash: 0, celebrate: 0, recover: 0, lookX: 0, lookY: 0, danger: false, speech: '', speechTime: 0, knockback: 0, airJump: true, dash: 0, dashCooldown: 0, dashDirection: 1, grapple: null }
  }

  getSnapshot(): GameSnapshot {
    return { difficulty: this.difficulty, rush: { ...this.rush }, rushWins: this.rushWins, totalBugs: LEVELS.reduce((sum, l) => sum + l.bugs.length, 0), revertCharges: this.powers.revertCharges, sudo: Math.ceil(this.powers.sudo), breakpoint: Math.ceil(this.powers.breakpoint),
      score: this.score, combo: this.chain, bestCombo: this.bestCombo, dashReady: this.player.dashCooldown <= 0, health: this.health, gameOver: this.gameOver, deaths: this.deaths, checkpoint: this.checkpoint, finished: this.finished, paused: this.paused,
      grappled: !!this.player.grapple, purge: this.purgeState, shotReady: this.shotCooldown <= 0,
      bossCommand: this.boss.applied || this.boss.announce > 0 ? this.boss.command : null, bossAnnounce: this.boss.announce > 0,
      level: this.level, levelComplete: this.levelComplete, bossHealth: this.boss.health, bits: this.collected.size, totalBits: LEVELS.reduce((n, l) => n + l.bits.length, 0), hotfix: this.hotfix, secret: this.secret, bugs: this.defeated.size, seconds: this.elapsed }
  }

  private publish() { this.onChange(this.getSnapshot()) }

  setDifficulty(difficulty: Difficulty) {
    if (this.elapsed > 0 || this.level > 0 || this.gameOver) return
    this.difficulty = difficulty; this.health = livesFor(difficulty); this.publish()
  }

  unlockAudio() { this.audio.unlock() }
  setAudio(enabled: boolean) { this.audio.setEnabled(enabled) }
  setCopy(copy: BugHuntCopy) { this.copy = copy; if (this.paused) this.draw() }
  setReducedMotion(enabled: boolean) { this.reducedMotion = enabled; this.shake = 0; if (this.paused) this.draw() }

  keyDown(code: string) {
    if (this.paused || this.gameOver || this.finished || this.levelComplete) return
    if (['KeyX', 'ShiftLeft', 'ShiftRight'].includes(code) && !this.keys.has(code) && this.player.dashCooldown <= 0 && this.player.knockback <= 0) {
      const p = this.player
      this.releaseGrapple(false)
      p.dash = 0.18; p.dashCooldown = 0.85
      p.dashDirection = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) || p.facing
      p.facing = p.dashDirection; p.vy = 0
      this.burst(p.x + 17, p.y + 24, ['#82ffec', '#be8cff'], 16, 190)
      this.audio.play('dash'); this.publish()
    }
    if (code === 'KeyR' && !this.keys.has(code)) this.startRewind()
    if (code === 'KeyE' && !this.keys.has(code)) this.tryGrapple()
    if (code === 'KeyF' && !this.keys.has(code)) this.fire()
    if (code === 'Space' && !this.keys.has(code)) {
      if (this.player.grapple) this.releaseGrapple(true)
      else this.player.buffer = 0.12
    }
    this.keys.add(code)
  }

  keyUp(code: string) {
    this.keys.delete(code)
    if (code === 'KeyE') this.releaseGrapple(true)
    if (code === 'Space' && this.player.vy * this.gravitySign < -180) this.player.vy *= 0.52
  }

  clearKeys() { this.keys.clear(); this.setCrouch(false); this.player.buffer = 0; this.player.dash = 0; this.player.grapple = null }

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
    clearActivePowers(this.powers)
    this.rush = createRush()
    this.level++
    this.levelComplete = false
    this.checkpoint = false; this.hotfix = false
    this.enemies = this.map.bugs.map(b => ({ ...b }))
    this.platforms = this.map.platforms.map(p => ({ ...p, originX: p.x, originY: p.y, crumble: 0 }))
    this.boss = createBoss()
    this.lesson = { index: -1, announce: 0, remaining: 0, done: new Set<number>() }; this.slowRemaining = 0; this.slowUsed = false
    this.player = this.makePlayer(58); this.camera = 0
    this.resetPurge(); this.shots = []; this.shotCooldown = 0; this.gravitySign = 1
    this.particles = []; this.popups = []; this.clearKeys()
    this.visualTime = 0; this.lastTime = null; this.accumulator = 0
    this.setPaused(false); this.publish()
  }

  restart() {
    this.rush = createRush(); this.rushWins = 0; this.bossRewards.clear()
    this.score = 0; this.chain = 0; this.bestCombo = 0; this.comboTime = 0; this.springCooldown = 0
    this.powers = createPowerState(); this.worldTime = 0; this.publishedPowers = ''
    this.level = 0; this.levelComplete = false; this.boss = createBoss()
    this.lesson = { index: -1, announce: 0, remaining: 0, done: new Set<number>() }; this.slowRemaining = 0; this.slowUsed = false
    this.platforms = this.map.platforms.map(p => ({ ...p, originX: p.x, originY: p.y, crumble: 0 }))
    this.health = livesFor(this.difficulty); this.gameOver = false; this.deaths = 0; this.checkpoint = false; this.finished = false; this.hotfix = false; this.secret = false
    this.enemies = this.map.bugs.map(b => ({ ...b }))
    this.collected.clear(); this.defeated.clear(); this.particles = []; this.popups = []
    this.player = this.makePlayer(58)
    this.resetPurge(); this.shots = []; this.shotCooldown = 0; this.gravitySign = 1
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
    if ((!fell && (this.player.invulnerable > 0 || this.powers.sudo > 0)) || this.gameOver || this.finished || this.powers.rewind) return
    this.chain = 0; this.comboTime = 0; this.player.dash = 0; this.player.grapple = null
    if (Number.isFinite(this.health)) this.health--
    this.audio.play('hurt')
    this.burst(this.player.x + 17, Math.min(480, this.player.y + 24), ['#ff8f9f', '#c778e8', '#f1c7fc'], 22)
    this.shake = 4
    const died = this.health <= 0
    if (died) {
      this.deaths++; this.gameOver = true
      clearActivePowers(this.powers); this.clearKeys(); this.audio.stop()
      this.publish()
      return
    }
    if (fell) {
      clearActivePowers(this.powers)
      this.boss = createBoss()
      this.lesson = { index: -1, announce: 0, remaining: 0, done: new Set<number>() }; this.slowRemaining = 0; this.slowUsed = false
      for (const platform of this.platforms) { platform.crumble = 0; platform.deleted = false }
      this.resetPurge(); this.shots = []; this.gravitySign = 1
      this.player = this.makePlayer(this.checkpoint ? this.checkpointX : 58)
      this.camera = Math.max(0, Math.min(levelWidth(this.level) - WIDTH, this.player.x - 310))
      this.popup(this.copy.rollback, this.player.x + 65, this.player.y - 20)
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
      if (this.rush.state === 'active' && bit.x >= RUSH_START && bit.x <= RUSH_END) {
        this.rush.collected++
        if (this.rush.collected >= RUSH_TARGET) {
          this.rush.state = 'won'; this.rushWins++; this.score += RUSH_BONUS
          this.popup(this.copy.rushWon, bit.x, bit.y - 55, '#ffdf88')
          this.burst(bit.x, bit.y, ['#ffe399', '#9fffde', '#dab6ff'], 45, 230)
          this.audio.play('win')
        }
      }
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
    for (const [index, power] of this.map.powers.entries()) {
      const key = pickupKey(this.level, index)
      if (this.powers.picked.has(key)) continue
      if (!intersects(rect, { x: power.x - PICKUP_SIZE / 2, y: power.y - PICKUP_SIZE / 2, w: PICKUP_SIZE, h: PICKUP_SIZE })) continue
      this.powers.picked.add(key)
      this.activatePower(power.kind, power.x, power.y)
    }
    if (!this.hotfix && intersects(rect, levelHotfix(this.level))) {
      this.hotfix = true
      this.burst(levelHotfix(this.level).x + 15, levelHotfix(this.level).y + 17, ['#b9ffe9', '#5fe5c0', '#d6b3ff'], 34, 180)
      this.audio.play('hotfix')
      this.popup(this.copy.hotfixPickup, levelHotfix(this.level).x, levelHotfix(this.level).y - 28, '#abffe2')
      this.publish()
    }
  }

  private update(dt: number) {
    if (this.paused || this.gameOver) return
    this.visualTime += dt
    this.shake = Math.max(0, this.shake - dt * 18)
    for (const particle of this.particles) {
      particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += particle.gravity * dt
    }
    this.particles = this.particles.filter((particle) => particle.life > 0)
    for (const popup of this.popups) { popup.life -= dt; popup.y -= dt * 20 }
    this.popups = this.popups.filter((popup) => popup.life > 0)
    if (this.gameOver || this.finished || this.levelComplete) return
    if (this.comboTime > 0) {
      this.comboTime = Math.max(0, this.comboTime - dt)
      if (this.comboTime === 0) { this.chain = 0; this.publish() }
    }
    if (this.rush.state === 'active') {
      this.rush.remaining = Math.max(0, this.rush.remaining - dt)
      if (this.rush.remaining === 0) { this.rush.state = 'missed'; this.publish() }
    }
    if (this.rush.state === 'waiting' && this.player.x >= RUSH_START && this.player.x < RUSH_END) {
      this.rush.state = 'active'
      this.popup(this.copy.rushStart, this.player.x + 70, this.player.y - 45, '#ffdf88'); this.publish()
    }
    this.springCooldown = Math.max(0, this.springCooldown - dt)
    this.elapsed += dt
    if (Math.floor(this.elapsed) !== this.publishedSecond) { this.publishedSecond = Math.floor(this.elapsed); this.publish() }
    if (this.powers.rewind) { this.stepRewind(); return }
    const frozen = this.tickPowers(dt)
    this.stepEnvironment(dt, frozen)
    const worldDt = this.slowRemaining > 0 ? dt * 0.45 : dt
    if (!frozen) this.worldTime += worldDt
    this.stepBossCommand(worldDt, frozen)
    this.resolveGravity()
    const p = this.player
    for (const platform of this.platforms) {
      const oldX = platform.x, oldY = platform.y
      if (platform.verticalTravel) platform.y = platform.originY! + Math.sin(this.worldTime * 1.4) * platform.verticalTravel
      if (platform.travel) platform.x = platform.originX! + Math.sin(this.worldTime * 1.5) * platform.travel
      if (p.grounded && Math.abs(p.y + p.h - oldY) < 1 && p.x + p.w > oldX && p.x < oldX + platform.w) {
        p.x += platform.x - oldX; p.y += platform.y - oldY
        if (platform.unstable && !platform.crumble) platform.crumble = 0.001
      }
      if (platform.crumble && !frozen) {
        platform.crumble += worldDt
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
    p.squash *= Math.exp(-dt * 10)
    p.celebrate = Math.max(0, (p.celebrate ?? 0) - dt)
    p.recover = Math.max(0, (p.recover ?? 0) - dt)
    p.speechTime = Math.max(0, (p.speechTime ?? 0) - dt)
    const threats = [...this.enemies.filter(b => b.alive).map(b => ({ x: b.x + b.w / 2, y: b.y + 10 })),
      ...this.shots.filter(s => s.enemy), ...this.boss.envelopes]
    const nearest = threats.filter(t => Math.hypot(t.x - p.x - 17, t.y - p.y - 17) < 260)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]
    p.danger = !!nearest
    const lookX = nearest ? Math.max(-2.5, Math.min(2.5, (nearest.x - p.x - 17) / 55)) : p.facing
    const lookY = nearest ? Math.max(-1.5, Math.min(1.5, (nearest.y - p.y - 17) / 65)) : 0
    p.lookX = (p.lookX ?? 0) + (lookX - (p.lookX ?? 0)) * Math.min(1, dt * 12)
    p.lookY = (p.lookY ?? 0) + (lookY - (p.lookY ?? 0)) * Math.min(1, dt * 12)
    p.coyote = p.grounded ? 0.1 : Math.max(0, p.coyote - dt)
    p.buffer = Math.max(0, p.buffer - dt)
    const horizontal = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'))
    this.setCrouch((this.keys.has('KeyS') || this.keys.has('ArrowDown')) && p.grounded && !p.grapple && p.dash <= 0 && p.knockback <= 0)
    if (p.dash > 0) { p.vx = p.dashDirection * 720; p.vy = 0 }
    else if (p.knockback > 0) p.knockback -= dt
    else {
      const target = horizontal * RUN_SPEED * (p.crouch ? CROUCH_SPEED : 1)
      const acceleration = (horizontal ? 2800 : 3400) * dt
      p.vx += Math.max(-acceleration, Math.min(acceleration, target - p.vx))
    }
    if (horizontal && p.dash <= 0) p.facing = horizontal
    if (p.buffer > 0 && (p.coyote > 0 || p.airJump) && p.dash <= 0) {
      const doubleJump = p.coyote <= 0
      if (doubleJump) { p.airJump = false; this.burst(p.x + 17, p.y + p.h, ['#8cf7ec', '#ffffff'], 18, 150) }
      p.vy = -JUMP_SPEED * this.gravitySign * (this.keys.has('Space') ? 1 : 0.67)
      p.grounded = false; p.coyote = 0; p.buffer = 0; p.squash = -0.12
      this.burst(p.x + 17, p.y + p.h, ['#b797e5', '#80ced9'], 9, 80)
      this.audio.play('jump')
    }
    const previousLeft = p.x, previousRight = p.x + p.w
    p.x = Math.max(0, Math.min(levelWidth(this.level) - p.w, p.x + p.vx * dt))
    for (const platform of this.platforms) {
      if (platform.deleted || platformOffline(platform, this.worldTime) || (platform.crumble ?? 0) > 0.8) continue
      if (platform.floating) continue
      if (!intersects(p, platform)) continue
      if (p.vx > 0 && previousRight <= platform.x) p.x = platform.x - p.w
      else if (p.vx < 0 && previousLeft >= platform.x + platform.w) p.x = platform.x + platform.w
    }
    this.resolveGravity()
    const previousBottom = p.y + p.h, previousTop = p.y
    for (const fan of this.map.fans ?? []) if (intersects(p, fan) && !frozen) p.vy = Math.max(-390, p.vy - worldDt * 2900)
    p.vy = p.dash > 0 ? 0 : Math.max(-1000, Math.min(1000, p.vy + GRAVITY * this.gravitySign * dt))
    p.y += p.vy * dt
    p.grounded = false
    for (const platform of this.platforms) {
      if (platform.deleted || platformOffline(platform, this.worldTime) || (platform.crumble ?? 0) > 0.8) continue
      if (!intersects(p, platform)) continue
      const onTop = p.vy >= 0 && previousBottom <= platform.y + 0.01
      const onUnderside = p.vy <= 0 && previousTop >= platform.y + platform.h - 0.01
      if (this.gravitySign < 0) {
        // Upside down, only solid slabs hold: a0 lands on the ceiling.
        if (platform.floating) continue
        if (onUnderside) {
          p.y = platform.y + platform.h
          if (!wasGrounded && p.vy < -160) {
            p.squash = Math.min(0.28, Math.abs(p.vy) / 2800)
            this.burst(p.x + 17, platform.y + platform.h + 1, ['#b797e5', '#80ced9'], 7, 65)
            this.audio.play('land')
          }
          p.vy = 0; p.grounded = true; p.airJump = true
        } else if (onTop) { p.y = platform.y - p.h; p.vy = 0 }
        continue
      }
      if (onTop) {
        p.y = platform.y - p.h
        if (!wasGrounded && p.vy > 160) {
          p.squash = Math.min(0.28, Math.abs(p.vy) / 2800)
          this.burst(p.x + 17, platform.y - 1, ['#b797e5', '#80ced9'], 7, 65)
          this.audio.play('land')
        }
        if (!wasGrounded && (p.x < platform.x + 12 || p.x + p.w > platform.x + platform.w - 12)) {
          p.recover = 0.65
          if ((p.speechTime ?? 0) === 0) { p.speech = this.copy.edgeQuip; p.speechTime = 2.4 }
        }
        p.vy = 0; p.grounded = true; p.airJump = true
      } else if (!platform.floating && onUnderside) {
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
    this.stepGrapple(dt)
    if (p.grapple && !this.reducedMotion) this.burst(p.grapple.x, p.grapple.y, ['#8cf7ec'], 1, 12)
    if (p.dash > 0 && !this.reducedMotion) this.burst(p.x + 17, p.y + 28, ['#7afce0', '#c394ff'], 2, 15)
    if (this.stepPurge(worldDt, frozen)) return
    if (p.y > HEIGHT + 70 || (this.gravitySign < 0 && p.y < -120)) { this.hurt(true); return }
    if (p.grounded && Math.abs(p.vx) > 90 && this.elapsed - this.lastDust > 0.1) {
      this.lastDust = this.elapsed
      this.burst(p.x + 17 - p.facing * 12, p.y + p.h - 2, ['#9175bd', '#73bdca'], 2, 32)
    }
    for (let index = 0; index < this.enemies.length; index++) {
      const bug = this.enemies[index]
      if (!bug.alive) continue
      if (!frozen) bug.wake = Math.max(0, (bug.wake ?? 0) - dt)
      if (bug.hover && bug.kind !== 'flyer' && bug.kind !== 'timeout') bug.y = bug.homeY! + Math.sin(this.worldTime * 2 + bug.phase) * 9
      if (bug.retry) bug.y = 426 - Math.max(0, Math.sin(this.worldTime * 3 + bug.phase)) * 74
      if (!frozen) this.stepBugAI(bug, worldDt)
      if (bug.kind !== 'turret' && !bug.hover) {
        // A charging bug still stops at its band: it never walks into a pit.
        if (bug.x <= bug.left) { bug.x = bug.left; if ((bug.alert ?? 0) <= 0.6) bug.direction = 1 }
        if (bug.x >= bug.right) { bug.x = bug.right; if ((bug.alert ?? 0) <= 0.6) bug.direction = -1 }
      }
      if (!intersects(p, bug)) continue
      const stomp = p.vy > 80 && previousBottom <= bug.y + 8
      if (p.dash > 0 || this.powers.sudo > 0 || stomp) {
        if (bug.kind === 'null' && (bug.wake ?? 0) > 0) continue
        if (bug.kind === 'null') bug.wake = 0.6
        const lethal = p.dash > 0 || this.powers.sudo > 0
        const died = this.damage(bug, index, lethal && bug.kind !== 'null' ? 99 : 1, false)
        if (p.dash <= 0 && stomp) { p.y = bug.y - p.h; p.vy = this.keys.has('Space') ? -540 : -390 }
        p.airJump = true; p.dashCooldown = 0; p.squash = -0.1
        // An armoured bug that survives must not damage a0 on the way down.
        if (!died) p.invulnerable = Math.max(p.invulnerable, 0.45)
      } else { this.hurt(); if (this.gameOver || this.player !== p) return }
    }
    if (this.keys.has('KeyF')) this.fire()
    if (this.stepShots(worldDt, frozen)) return
    for (const spike of this.map.spikes) if (this.powers.sudo <= 0 && intersects(p, spike)) { this.hurt(); if (this.gameOver || this.player !== p) return }
    for (const wall of this.map.firewalls) {
      if (firewallPhase(this.worldTime, wall.phase) === 'active' && p.dash <= 0 && this.powers.sudo <= 0 && intersects(p, wall)) {
        this.hurt(); if (this.gameOver || this.player !== p) return
      }
    }
    if (this.level === 2 && this.boss.health > 0 && p.x > 2450) {
      const boss = this.boss
      const before = boss.clock
      if (!frozen) boss.clock += worldDt
      for (const attack of bossPhase(boss.health) === 2 ? [0.9, 1.4, 1.9] : [1.3, 1.85]) {
        if (before < attack && boss.clock >= attack) this.throwEnvelope(boss)
      }
      if (boss.clock > 4.8) { boss.clock = 0; boss.hit = false }
      boss.recoil = Math.max(0, boss.recoil - dt)
      if (this.stepEnvelopes(boss, worldDt, frozen)) return
      if (intersects(p, BOSS_BODY)) {
        if (this.bossOpen() && p.vy > 80 && previousBottom <= BOSS_BODY.y + 10) {
          this.hitBoss()
          p.y = BOSS_BODY.y - p.h; p.vy = -540; p.invulnerable = 0.6
          this.burst(BOSS_BODY.x + 45, BOSS_BODY.y, ['#a6ffe3', '#e8cbff'], 40)
          this.audio.play(boss.health ? 'stomp' : 'win'); this.publish()
          if (!boss.health) { boss.envelopes = []; this.endCommand(); boss.command = null; this.popup(this.copy.bossDefeated, BOSS_BODY.x, 290) }
        } else { this.hurt(); if (this.gameOver || this.player !== p) return }
      }
    }
    // Every rewritten rule is local to the arena: walking out restores gravity.
    this.resolveGravity()
    if (!this.checkpoint && p.x + p.w > this.checkpointX && p.x < this.checkpointX + 40 && p.y < 460) {
      this.checkpoint = true
      p.celebrate = 1.2; p.speech = this.copy.checkpointQuip; p.speechTime = 2.6
      this.burst(this.checkpointX + 13, 417, ['#a3ffe2', '#5ccfae', '#d7c0ff'], 28, 160)
      this.popup(this.copy.commitSaved, this.checkpointX + 30, 367, '#acffe0')
      this.audio.play('checkpoint'); this.publish()
    }
    this.collect(p)
    if (p.x + p.w > levelExit(this.level) - 25) {
      if (this.hotfix && !this.enemies.some(b => b.kind === 'null' && b.alive) && (this.level !== 2 || this.boss.health === 0)) {
        this.finished = this.level === LEVELS.length - 1; this.levelComplete = !this.finished; this.clearKeys()
        this.burst(levelExit(this.level), 385, ['#f5d77c', '#88f1d0', '#be8dff', '#ff9dad'], 70, 270)
        this.audio.play('win'); this.publish()
      } else {
        p.x = levelExit(this.level) - 25 - p.w
        if (this.elapsed - this.lastGateHint > 3) {
          this.lastGateHint = this.elapsed
          this.popup(this.hotfix ? (this.level === 0 ? this.copy.nullLocked : this.copy.bossLocked) : this.copy.missingHotfix, levelExit(this.level) - 75, 347, '#e6c0ff')
        }
      }
    }
    recordFrame(this.powers, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing })
    this.followCamera(dt)
  }

  private followCamera(dt: number) {
    const target = Math.max(0, Math.min(levelWidth(this.level) - WIDTH, this.player.x - 310))
    this.camera += (target - this.camera) * Math.min(1, dt * 8)
  }

  /** Crouch keeps the feet planted: the box shrinks toward the surface a0 stands on. */
  private setCrouch(on: boolean) {
    const p = this.player
    if (on === p.crouch) return
    const drop = this.gravitySign > 0 ? PLAYER_H - CROUCH_H : 0
    if (on) { p.y += drop; p.h = CROUCH_H; p.crouch = true; return }
    // ponytail: refuse to stand inside a slab, otherwise a0 wedges into the ceiling it crawled under.
    const standing = { x: p.x, y: p.y - drop, w: p.w, h: PLAYER_H }
    const blocked = this.platforms.some(slab => !slab.deleted && !slab.floating && !platformOffline(slab, this.worldTime) && (slab.crumble ?? 0) <= 0.8 && intersects(standing, slab))
    if (blocked) return
    p.y = standing.y; p.h = PLAYER_H; p.crouch = false
  }

  private aimingUp() {
    return !this.player.grapple && (this.keys.has('KeyW') || this.keys.has('ArrowUp'))
  }

  /** a0's debug packet: short cooldown, light recoil, nothing to reload. Hold up to fire at the ceiling. */
  private fire() {
    const p = this.player
    if (this.shotCooldown > 0 || this.powers.rewind || this.gameOver || this.finished || this.levelComplete) return
    const up = this.aimingUp()
    this.shotCooldown = SHOT_COOLDOWN
    const x = p.x + p.w / 2 + (up ? 0 : p.facing * 20)
    const y = up ? p.y - 6 : p.y + (p.crouch ? 8 : 17)
    this.shots.push({ x, y, vx: up ? 0 : p.facing * SHOT_SPEED, vy: up ? -SHOT_SPEED : 0, life: 1.15, enemy: false })
    this.burst(x + (up ? 0 : p.facing * 4), y - (up ? 4 : 0), ['#9ff0ff', '#ffffff'], 5, 80)
    if (p.grounded && !up) p.vx -= p.facing * 22
    this.audio.play('shoot')
    this.publish()
  }

  /** Applies damage and closes the ticket when the bug runs out of health. */
  private damage(bug: Bug, index: number, amount: number, fromShot: boolean): boolean {
    if (bug.kind === 'null' && fromShot && (bug.wake ?? 0) > 0) return false
    if (bug.kind === 'null' && fromShot) bug.wake = 0.35
    bug.hp = (bug.hp ?? 1) - amount
    if (bug.hp > 0) {
      bug.alert = 1
      this.burst(bug.x + 19, bug.y + 15, ['#ffd0a8', '#ff8d9e'], 10, 115)
      this.audio.play('hit')
      return false
    }
    const id = this.level * 100 + index
    if (!bug.summoned && !this.defeated.has(id)) this.reward(100, bug.x, bug.y)
    bug.alive = false; if (!bug.summoned) this.defeated.add(id)
    this.shake = Math.max(this.shake, fromShot ? 1.6 : 2.4)
    this.burst(bug.x + 19, bug.y + 15, ['#ff8d9e', '#ffc6b8', '#b28fe7'], 24, 165)
    this.popup(this.copy.bugClosed[index % this.copy.bugClosed.length], bug.x + 20, bug.y - 25, '#ffd4d2')
    this.audio.play('stomp'); this.publish()
    return true
  }

  /** Chasers charge when a0 is close; turrets aim, charge, then fire. */
  private stepBugAI(bug: Bug, dt: number) {
    const p = this.player
    if (stepSpecialBug(bug, p, dt, this.worldTime, this.shots)) return
    const dx = p.x + p.w / 2 - (bug.x + bug.w / 2)
    const sameFloor = Math.abs(p.y + p.h - (bug.y + bug.h)) < 150
    if (bug.kind === 'turret') {
      const inRange = Math.abs(dx) < TURRET_RANGE && sameFloor
      bug.alert = inRange ? Math.min(1, (bug.alert ?? 0) + dt * 2.2) : Math.max(0, (bug.alert ?? 0) - dt * 2)
      if (!inRange) { bug.fuse = 0; return }
      bug.direction = Math.sign(dx) || bug.direction
      bug.fuse = (bug.fuse ?? 0) + dt
      if (bug.fuse < TURRET_CYCLE) return
      bug.fuse = 0
      this.shots.push({ x: bug.x + 19 + bug.direction * 24, y: bug.y + 13, vx: bug.direction * BOLT_SPEED, life: 2.6, enemy: true })
      this.burst(bug.x + 19 + bug.direction * 24, bug.y + 13, ['#ffb56b', '#ff668c'], 8, 95)
      this.audio.play('bolt')
      return
    }
    if (bug.kind === 'chaser') {
      const hunting = Math.abs(dx) < CHASE_RANGE && sameFloor
      const was = bug.alert ?? 0
      bug.alert = hunting ? Math.min(1, was + dt * 2.5) : Math.max(0, was - dt * 1.2)
      // One shout the moment it wakes: the charge is never a silent ambush.
      if (was <= 0.6 && bug.alert > 0.6) { this.popup(this.copy.bugAlert, bug.x + 19, bug.y - 34, '#ff9db4'); this.audio.play('bolt') }
      if (bug.alert > 0.6) {
        bug.direction = Math.sign(dx) || bug.direction
        bug.x += bug.direction * CHASE_SPEED * dt
        return
      }
    }
    bug.x += bug.direction * 82 * dt
  }

  /** Moves both sides' fire. Returns true when a0 was hit and respawned. */
  private stepShots(dt: number, frozen: boolean): boolean {
    const p = this.player
    this.shotCooldown = Math.max(0, this.shotCooldown - dt)
    for (const shot of this.shots) {
      if (shot.enemy && frozen) continue
      shot.x += shot.vx * dt; shot.y += (shot.vy ?? 0) * dt
      shot.life -= dt
    }
    for (const shot of this.shots) {
      if (shot.life <= 0) continue
      const hitbox = { x: shot.x - 8, y: shot.y - 5, w: 16, h: 10 }
      if (!shot.enemy) {
        for (const [index, bug] of this.enemies.entries()) {
          if (!bug.alive || !intersects(bug, hitbox)) continue
          shot.life = 0
          this.damage(bug, index, 1, true)
          break
        }
        if (shot.life <= 0) continue
        if (this.level === 2 && this.boss.health > 0) {
          const module = BOSS_MODULES.findIndex(m => intersects(m, hitbox))
          if (module >= 0 && bossPhase(this.boss.health) === 2 && this.boss.modules[module] > 0) {
            shot.life = 0; this.boss.modules[module]--
            this.burst(shot.x, shot.y, ['#9dffc4', '#ffd0a8'], 18, 150)
            this.audio.play('hit'); this.publish(); continue
          }
          if (module >= 0 && this.bossOpen()) { shot.life = 0; this.hitBoss(); continue }
        }
        const envelope = this.boss.envelopes.find(candidate => intersects(candidate, hitbox))
        if (envelope) {
          shot.life = 0
          this.boss.envelopes = this.boss.envelopes.filter(candidate => candidate !== envelope)
          this.reward(25, envelope.x + 18, envelope.y)
          this.burst(envelope.x + 18, envelope.y + 13, ['#eaf0ff', '#9ab4ff', '#ffffff'], 16, 140)
          this.audio.play('hit')
        }
        continue
      }
      // ponytail: linear scan, only a handful of projectiles are ever in flight.
      const intercept = this.shots.find(other => !other.enemy && other.life > 0 && Math.abs(other.x - shot.x) < 18 && Math.abs(other.y - shot.y) < 15)
      if (intercept) {
        shot.life = 0; intercept.life = 0
        this.burst(shot.x, shot.y, ['#ffd0a8', '#9ff0ff', '#ffffff'], 12, 130)
        this.audio.play('hit')
        continue
      }
      if (!intersects(p, hitbox)) continue
      shot.life = 0
      if (p.dash > 0 || this.powers.sudo > 0) continue
      this.hurt()
      if (this.gameOver || this.player !== p) return true
    }
    this.shots = this.shots.filter(shot => shot.life > 0 && Math.abs(shot.x - (p.x + p.w / 2)) < 1200 && shot.y > -160 && shot.y < HEIGHT + 160)
    return false
  }

  /** Latches onto the nearest lit anchor above a0. Misses are never punished. */
  private tryGrapple() {
    const p = this.player
    if (p.grapple || this.powers.rewind) return
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2
    let best: { x: number; y: number } | null = null
    let bestDistance = GRAPPLE_RANGE
    for (const anchor of this.map.anchors) {
      const distance = Math.hypot(anchor.x - cx, anchor.y - cy)
      if (distance < bestDistance && anchor.y < cy - 24) { best = anchor; bestDistance = distance }
    }
    if (!best) { this.popup(this.copy.grappleMiss, cx, p.y - 22, '#c9d3e6'); return }
    p.grapple = { x: best.x, y: best.y, length: Math.max(GRAPPLE_MIN, bestDistance) }
    p.dash = 0; p.knockback = 0
    this.burst(best.x, best.y, ['#8cf7ec', '#c394ff'], 14, 130)
    this.audio.play('power')
    this.publish()
  }

  /** Releasing at the bottom of the arc converts the swing into a launch. */
  private releaseGrapple(boost: boolean) {
    const p = this.player
    if (!p.grapple) return
    p.grapple = null
    if (boost) {
      p.vx = Math.max(-700, Math.min(700, p.vx * 1.18))
      p.vy = Math.min(p.vy, 0) - GRAPPLE_LAUNCH
      p.grounded = false; p.coyote = 0; p.airJump = true; p.dashCooldown = 0; p.squash = -0.16
      this.burst(p.x + 17, p.y + p.h, ['#8cf7ec', '#ffffff', '#c394ff'], 18, 165)
      this.popup(this.copy.grappleLaunch, p.x + 17, p.y - 18, '#9ff0ff')
      this.audio.play('spring')
    }
    this.publish()
  }

  /** Keeps a0 on the cable: radial velocity is cancelled, tangential kept. */
  private stepGrapple(dt: number) {
    const p = this.player
    const cable = p.grapple
    if (!cable) return
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) cable.length = Math.max(GRAPPLE_MIN, cable.length - GRAPPLE_REEL * dt)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) cable.length = Math.min(GRAPPLE_RANGE, cable.length + GRAPPLE_REEL * dt)
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2
    const dx = cx - cable.x, dy = cy - cable.y
    const distance = Math.hypot(dx, dy) || 1
    if (distance <= cable.length) return
    const nx = dx / distance, ny = dy / distance
    p.x -= nx * (distance - cable.length)
    p.y -= ny * (distance - cable.length)
    const radial = p.vx * nx + p.vy * ny
    if (radial > 0) { p.vx -= nx * radial; p.vy -= ny * radial }
    if (p.y + p.h < 458) p.grounded = false
  }

  /** One fist winds up and lobs a SOAP envelope at a0. */
  private throwEnvelope(boss: Boss) {
    const p = this.player
    const arm = boss.arm ? 0 : 1
    const fist = BOSS_FISTS[arm]
    const toward = Math.sign(p.x + p.w / 2 - fist.x) || -1
    boss.envelopes.push({ x: fist.x - 18, y: fist.y - 13, w: 36, h: 26, vx: toward * ENVELOPE_SPEED, vy: -70, spin: 0, kind: ['soap', 'xml', 'error'][Math.floor(boss.clock * 10) % 3] as 'soap' | 'xml' | 'error' })
    boss.arm = arm; boss.recoil = 0.35
    this.burst(fist.x, fist.y, ['#eaf0ff', '#9ab4ff'], 14, 115)
    if (arm === 0) this.popup(this.copy.bossTaunt, fist.x, fist.y - 52, '#cfe0ff')
    this.audio.play('bolt')
  }

  /** Arcs every envelope. Returns true when a0 was hit and respawned. */
  private stepEnvelopes(boss: Boss, dt: number, frozen: boolean): boolean {
    const p = this.player
    const flying: typeof boss.envelopes = []
    for (const envelope of boss.envelopes) {
      if (!frozen && !(envelope.warning && envelope.warning > 0)) {
        envelope.x += envelope.vx * dt
        envelope.vy += ENVELOPE_GRAVITY * dt
        envelope.y += envelope.vy * dt
        envelope.spin += dt * (envelope.vx > 0 ? 3.4 : -3.4)
      }
      if ((envelope.warning ?? 0) > 0) { if (!frozen) envelope.warning = Math.max(0, envelope.warning! - dt); flying.push(envelope); continue }
      const landed = envelope.y + envelope.h >= 458 && envelope.vy > 0
      if (landed) {
        this.burst(envelope.x + 18, 452, ['#eaf0ff', '#b9c8ff', '#8fa4d8'], 16, 130)
        continue
      }
      if (envelope.x < 2140 || envelope.x > 3210) continue
      if (!intersects(p, envelope)) { flying.push(envelope); continue }
      if (p.dash > 0 || this.powers.sudo > 0) {
        this.burst(envelope.x + 18, envelope.y + 13, ['#eaf0ff', '#9ab4ff'], 16, 140)
        continue
      }
      boss.envelopes = flying
      this.hurt()
      if (this.gameOver || this.player !== p) return true
    }
    boss.envelopes = flying
    return false
  }

  private bossOpen() {
    return this.boss.clock >= 2 && !this.boss.hit && (this.boss.health > 1 || this.boss.modules.every(h => h === 0))
  }

  private hitBoss() {
    const boss = this.boss
    if (!this.bossOpen()) return
    boss.health--; boss.hit = true
    this.endCommand(); boss.command = null; boss.cooldown = 1
    if (!this.bossRewards.has(boss.health)) {
      this.bossRewards.add(boss.health); this.reward(boss.health === 0 ? 1000 : 250, BOSS_BODY.x, BOSS_BODY.y)
    }
    this.burst(BOSS_BODY.x + 45, BOSS_BODY.y, ['#a6ffe3', '#e8cbff'], 35)
    if (!boss.health) { boss.envelopes = []; this.popup(this.copy.bossDefeated, BOSS_BODY.x, 290) }
    this.audio.play(boss.health ? 'hit' : 'win'); this.publish()
  }

  /** Real-time control remains responsive during CPU pressure; only scenery slows. */
  private stepEnvironment(dt: number, frozen: boolean) {
    if (frozen) return
    const p = this.player
    if (this.map.slowZone && !this.slowUsed && intersects(p, this.map.slowZone)) {
      this.slowUsed = true; this.slowRemaining = 4
      this.popup(this.copy.cpuWarning, p.x + 80, 180, '#ffbf80')
    }
    this.slowRemaining = Math.max(0, this.slowRemaining - dt)
    const lesson = this.lesson
    if (lesson.index < 0) {
      const index = this.map.lessons?.findIndex((zone, i) => !lesson.done.has(i) && p.x >= zone.x - RUN_SPEED && p.x < zone.end) ?? -1
      if (index >= 0) { lesson.index = index; lesson.announce = 1; lesson.done.add(index) }
    }
    if (lesson.index < 0) return
    const zone = this.map.lessons![lesson.index]
    if (p.x >= zone.end) { lesson.index = -1; lesson.announce = 0; lesson.remaining = 0; return }
    if (lesson.announce > 0) {
      lesson.announce = Math.max(0, lesson.announce - dt)
      if (lesson.announce === 0) {
        lesson.remaining = COMMAND_SECONDS
        if (zone.command === 'clones') this.spawnClones(zone.x, 2)
      }
    } else {
      lesson.remaining = Math.max(0, lesson.remaining - dt)
      if (!lesson.remaining) lesson.index = -1
    }
  }

  /** Timed commands tick even if a0 leaves the arena; proximity never pins gravity. */
  private stepBossCommand(dt: number, frozen: boolean) {
    const b = this.boss
    if (this.level !== 2 || b.health <= 0 || frozen) return
    if (!b.started) { if (this.player.x < ARENA_X) return; b.started = true }
    const phase = bossPhase(b.health)
    if (phase !== b.phase) { this.endCommand(); b.command = null; b.phase = phase; b.sequence = 0; b.cooldown = 0 }
    if (phase === 0) return
    if (b.announce > 0) {
      b.announce = Math.max(0, b.announce - dt)
      if (b.announce === 0 && b.command) this.applyCommand(b.command)
    } else if (b.remaining > 0) {
      b.remaining = Math.max(0, b.remaining - dt)
      if (b.remaining === 0) { this.endCommand(); b.command = null; b.cooldown = 2; this.publish() }
      else if (b.command) this.stepCommand(b.command)
    } else {
      b.cooldown = Math.max(0, b.cooldown - dt)
      if (!b.cooldown) {
        b.command = BOSS_COMMANDS[b.sequence++ % BOSS_COMMANDS.length]
        b.announce = BOSS_ANNOUNCE; this.audio.play('sudo'); this.publish()
      }
    }
    if (phase === 2) {
      b.debrisClock += dt
      if (b.debrisClock >= 2.2) {
        b.debrisClock = 0
        // ponytail: derived from the clock, so it never disturbs the command rotation.
        const variant = Math.floor(this.worldTime / 2.2) % DEBRIS.length
        b.envelopes.push({ x: Math.max(2450, Math.min(3070, this.player.x)), y: 148, ...DEBRIS[variant], vx: 0, vy: 30, spin: 0, kind: 'debris', variant, warning: 1 })
      }
    }
  }

  private resolveGravity() {
    const p = this.player, zone = this.map.lessons?.[this.lesson.index]
    const tutorial = zone?.command === 'gravity' && this.lesson.remaining > 0 && p.x >= zone.x && p.x + p.w <= zone.end
    const override = this.level === 2 && this.boss.command === 'gravity' && this.boss.remaining > 0 && this.boss.applied && p.x >= ARENA_X && p.x + p.w < GRAVITY_SAFE_X
    const next = tutorial || override ? -1 : 1
    if (next !== this.gravitySign) {
      this.gravitySign = next; p.grounded = false; p.coyote = 0; p.airJump = true; p.grapple = null
      // No forced launch: changing gravity preserves horizontal control and resets vertical momentum.
      p.vy = 0
    }
  }

  private endCommand() {
    this.boss.applied = false; this.boss.remaining = 0; this.boss.announce = 0
    for (const platform of this.platforms) if (platform.arena) platform.deleted = false
    this.resolveGravity()
  }

  private spawnClones(x: number, count: number) {
    // Clear previous summoned clones: no unbounded armies or score farming.
    this.enemies = this.enemies.filter(b => !b.summoned)
    for (let i = 0; i < count; i++) this.enemies.push({ x: x + 60 + i * 115, y: 412, w: 34, h: 48, left: x, right: x + 400,
      direction: -1, alive: true, phase: i, kind: 'clone', hp: 2, summoned: true })
  }

  private applyCommand(command: BossCommand) {
    this.boss.applied = true; this.boss.remaining = COMMAND_SECONDS
    if (command === 'clones') this.spawnClones(2460, 3)
    this.resolveGravity()
    this.audio.play(command === 'gravity' ? 'rewind' : command === 'clones' ? 'gc' : 'freeze')
  }

  private stepCommand(command: BossCommand) {
    if (command !== 'offline') return
    const slabs = this.platforms.filter(platform => platform.arena)
    const turn = Math.floor(this.worldTime / 1.4) % (slabs.length + 1)
    for (const [index, slab] of slabs.entries()) slab.deleted = index === turn
  }

  private resetPurge() {
    this.purgeState = this.map.purge ? 'waiting' : 'off'
    this.purgeX = this.map.purge ? this.map.purge.start - this.map.purge.lead : 0
  }

  /** The floor is being deleted. Returns true when a0 was caught and respawned. */
  private stepPurge(dt: number, frozen: boolean): boolean {
    const purge = this.map.purge
    if (!purge || this.purgeState === 'off' || this.purgeState === 'cleared') return false
    const p = this.player
    if (this.purgeState === 'waiting') {
      if (p.x < purge.start || p.x >= purge.end) return false
      this.purgeState = 'active'
      this.purgeX = p.x - purge.lead
      this.shake = 6
      this.popup(this.copy.purgeWarning, p.x + 40, p.y - 62, '#ff90a8')
      this.audio.play('gc'); this.publish()
      return false
    }
    if (!frozen) this.purgeX += purge.speed * dt
    for (const platform of this.platforms) {
      if (platform.deleted || platform.x + platform.w > this.purgeX) continue
      platform.deleted = true
      this.burst(platform.x + platform.w - 8, platform.y + 4, ['#ff7f9c', '#b388ff'], 9, 130)
    }
    for (const bug of this.enemies) if (bug.alive && bug.x + bug.w < this.purgeX) bug.alive = false
    if (p.x >= purge.end) {
      this.purgeState = 'cleared'
      this.score += 400
      this.popup(this.copy.purgeCleared, p.x + 40, p.y - 52, '#9dffc4')
      this.burst(p.x + 17, p.y + 24, ['#9dffc4', '#e8fff4', '#ffe399'], 42, 220)
      this.audio.play('win'); this.publish()
      return false
    }
    if (p.x + p.w > this.purgeX + 8) return false
    this.popup(this.copy.purgeDeath, p.x + 17, p.y - 20, '#ff9db4')
    this.hurt(true)
    return true
  }

  private activatePower(kind: PowerKind, x: number, y: number) {
    const powers = this.powers
    if (kind === 'revert') {
      powers.revertCharges = Math.min(REVERT_MAX_CHARGES, powers.revertCharges + 1)
      this.popup(this.copy.powerRevert, x, y - 72, '#9ad8ff')
    } else if (kind === 'breakpoint') {
      powers.breakpoint = BREAKPOINT_SECONDS
      this.popup(this.copy.powerBreakpoint, x, y - 72, '#ff9aa9')
    } else if (kind === 'sudo') {
      powers.sudo = SUDO_SECONDS
      this.popup(this.copy.powerSudo, x, y - 72, '#ffe08a')
    } else {
      powers.gc = { x: this.player.x + this.player.w / 2, y: this.player.y + this.player.h / 2, r: 0 }
      this.shake = 5
      this.popup(this.copy.powerGc, x, y - 72, '#9dffc4')
    }
    this.burst(x, y, ['#ffffff', '#b9f6ff', '#d7b4ff', '#ffe08a'], 30, 210)
    this.reward(50, x, y)
    this.audio.play(kind === 'gc' ? 'gc' : kind === 'breakpoint' ? 'freeze' : kind === 'sudo' ? 'sudo' : 'power')
    this.publish()
  }

  /** Runs timers and the Garbage Collector wave. Returns true while the world is paused on a breakpoint. */
  private tickPowers(dt: number): boolean {
    const powers = this.powers
    powers.sudo = Math.max(0, powers.sudo - dt)
    powers.breakpoint = Math.max(0, powers.breakpoint - dt)
    if (powers.gc) {
      const wave = powers.gc
      wave.r += GC_SPEED * dt
      for (const [index, bug] of this.enemies.entries()) {
        if (!bug.alive || bug.kind === 'null' || Math.hypot(bug.x + bug.w / 2 - wave.x, bug.y + bug.h / 2 - wave.y) > wave.r) continue
        bug.alive = false
        const id = this.level * 100 + index
        if (!bug.summoned && !this.defeated.has(id)) { this.defeated.add(id); this.reward(100, bug.x, bug.y) }
        this.burst(bug.x + 19, bug.y + 15, ['#9dffc4', '#e8fff4', '#7bd6ff'], 26, 180)
        this.popup(this.copy.freed(`0x${(0x3f2a + index * 0x1d7 + this.level * 0x91).toString(16)}`), bug.x + 20, bug.y - 25, '#b8ffd9')
        this.audio.play('stomp')
        this.publish()
      }
      this.boss.envelopes = this.boss.envelopes.filter((e) => Math.hypot(e.x + e.w / 2 - wave.x, e.y + e.h / 2 - wave.y) > wave.r)
      this.shots = this.shots.filter((s) => !s.enemy || Math.hypot(s.x - wave.x, s.y - wave.y) > wave.r)
      if (wave.r > GC_RADIUS) powers.gc = null
    }
    const signature = `${Math.ceil(powers.sudo)}|${Math.ceil(powers.breakpoint)}|${powers.revertCharges}`
    if (signature !== this.publishedPowers) { this.publishedPowers = signature; this.publish() }
    return powers.breakpoint > 0
  }

  private startRewind() {
    const powers = this.powers
    if (powers.rewind) return
    if (powers.revertCharges <= 0) { this.popup(this.copy.revertEmpty, this.player.x + 17, this.player.y - 20, '#c9d3e6'); return }
    if (powers.history.length < 20) return
    powers.revertCharges--
    powers.rewind = [...powers.history].reverse()
    powers.history = []
    this.player.dash = 0; this.player.knockback = 0
    this.popup(this.copy.revertUsed, this.player.x + 17, this.player.y - 30, '#9ad8ff')
    this.audio.play('rewind')
    this.publish()
  }

  /** Replays recorded positions backwards; the world stays still meanwhile. */
  private stepRewind() {
    const powers = this.powers
    const frames = powers.rewind!
    const frame = frames[Math.min(frames.length - 1, REWIND_SPEED - 1)]
    frames.splice(0, REWIND_SPEED)
    const p = this.player
    p.x = frame.x; p.y = frame.y; p.facing = frame.facing; p.vx = 0; p.vy = 0
    if (!frames.length) {
      powers.rewind = null
      p.speech = this.copy.rewindQuip; p.speechTime = 2.8
      p.vx = frame.vx; p.vy = Math.min(0, frame.vy)
      p.grounded = false; p.airJump = true; p.coyote = 0.1; p.invulnerable = Math.max(p.invulnerable, 0.8)
      this.burst(p.x + 17, p.y + 24, ['#9ad8ff', '#ffffff', '#c9a0ff'], 24, 170)
      this.publish()
    }
    this.followCamera(STEP)
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
      secret: this.secret, shake: this.shake, reducedMotion: this.reducedMotion, finished: this.finished, copy: this.copy,
      worldTime: this.worldTime, powers: this.powers, purgeX: this.purgeX, purgeState: this.purgeState, shots: this.shots, gravity: this.gravitySign, lesson: this.lesson, slowRemaining: this.slowRemaining })
  }
}
