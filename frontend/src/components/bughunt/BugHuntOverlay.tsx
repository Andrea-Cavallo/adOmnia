import { DIFFICULTIES, livesFor, type Difficulty } from './difficulty'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Box, Check, Cpu, Flag, Settings, Pause, Play, RotateCcw, Sparkles, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { BugHuntPrototype, HEIGHT, INITIAL_SNAPSHOT, WIDTH, type GameSnapshot } from './prototype'
import { formatTime, loadPreferences, savePreferences, type BugHuntPreferences } from './preferences'
import { BUG_HUNT_COPY } from './copy'
import { useSettingsStore } from '@/stores/settings'
import type { Lang } from '@/lib/i18n'
import './bughunt.css'
import { rankForScore, RUSH_TARGET } from './rush'
import { LEVELS } from './level'
import avatarUrl from './assets/a0-avatar.png'

const CONTROL_KEYS = new Set(['KeyC', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyE', 'KeyF'])

export function BugHuntOverlay({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const gameRef = useRef<BugHuntPrototype | null>(null)
  const closeRef = useRef(onClose)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT)
  const snapshotRef = useRef(snapshot)
  const [ready, setReady] = useState(true)
  const readyRef = useRef(true)
  const [preferences, setPreferences] = useState(() => loadPreferences())
  const preferencesRef = useRef(preferences)
  const [newRecord, setNewRecord] = useState(false)
  const resultSaved = useRef(false)
  closeRef.current = onClose
  const language = useSettingsStore((state) => state.settings.appearance.language ?? 'en') as Lang
  const copy = BUG_HUNT_COPY[language] ?? BUG_HUNT_COPY.en
  const copyRef = useRef(copy)
  copyRef.current = copy

  useEffect(() => {
    if (!canvasRef.current) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const game = new BugHuntPrototype(canvasRef.current, (next) => { snapshotRef.current = next; setSnapshot(next) }, { ...preferencesRef.current, copy: copyRef.current })
    gameRef.current = game
    game.setPaused(true)
    primaryRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Tab') {
        const buttons = Array.from(overlayRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).filter((button) => button.offsetParent !== null)
        if (!buttons.length) return
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (event.shiftKey && index <= 0) { event.preventDefault(); buttons[buttons.length - 1].focus() }
        else if (!event.shiftKey && (index === -1 || index === buttons.length - 1)) { event.preventDefault(); buttons[0].focus() }
        return
      }
      if (event.code === 'Escape') {
        event.stopImmediatePropagation(); event.preventDefault()
        if (event.repeat) return
        if (readyRef.current || (snapshotRef.current.finished || snapshotRef.current.gameOver)) closeRef.current()
        else if (!snapshotRef.current.levelComplete) game.setPaused(!snapshotRef.current.paused)
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.stopImmediatePropagation(); event.preventDefault(); return
      }
      const playing = !readyRef.current && !snapshotRef.current.paused && !(snapshotRef.current.finished || snapshotRef.current.gameOver) && !snapshotRef.current.levelComplete
      if (playing && CONTROL_KEYS.has(event.code)) {
        event.stopImmediatePropagation(); event.preventDefault()
        if (!event.repeat) game.keyDown(event.code)
      } else if (event.code.startsWith('Arrow')) {
        // Keep adOmnia's global spatial navigation out of the game menus.
        event.stopImmediatePropagation(); event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      game.keyUp(event.code)
      if (!readyRef.current && !snapshotRef.current.paused && !(snapshotRef.current.finished || snapshotRef.current.gameOver) && !snapshotRef.current.levelComplete && CONTROL_KEYS.has(event.code)) {
        event.stopImmediatePropagation(); event.preventDefault()
      }
    }
    // Losing focus releases held controls without covering the game with a pause menu.
    // Windows screenshot tools can take focus before keyup reaches this window.
    const releaseControls = () => game.clearKeys()
    const visibility = () => { if (document.hidden) releaseControls() }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', releaseControls)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', releaseControls)
      document.removeEventListener('visibilitychange', visibility)
      game.destroy(); gameRef.current = null
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  useEffect(() => { gameRef.current?.setCopy(copy) }, [copy])

  useEffect(() => {
    if (ready || snapshot.paused || snapshot.gameOver || snapshot.finished || snapshot.levelComplete) primaryRef.current?.focus()
    else overlayRef.current?.focus()
  }, [ready, snapshot.paused, snapshot.gameOver, snapshot.finished, snapshot.levelComplete])

  useEffect(() => {
    if (!snapshot.finished || snapshot.gameOver || resultSaved.current) return
    resultSaved.current = true
    const current = preferencesRef.current
    const improved = current.bestSeconds === null || snapshot.seconds < current.bestSeconds
    const next = { ...current, bestSeconds: improved ? snapshot.seconds : current.bestSeconds, bestBits: Math.max(current.bestBits, snapshot.bits), bestScore: Math.max(current.bestScore, snapshot.score) }
    preferencesRef.current = next; setPreferences(next); savePreferences(next, snapshotRef.current.difficulty); setNewRecord(improved || snapshot.score > current.bestScore)
  }, [snapshot.finished, snapshot.gameOver, snapshot.seconds, snapshot.bits, snapshot.score])

  const updatePreferences = (update: Partial<BugHuntPreferences>) => {
    const next = { ...preferencesRef.current, ...update }
    preferencesRef.current = next; setPreferences(next); savePreferences(next, snapshotRef.current.difficulty)
    gameRef.current?.setAudio(next.audio)
    gameRef.current?.setReducedMotion(next.reducedMotion)
  }
  const chooseDifficulty = (difficulty: Difficulty) => {
    gameRef.current?.setDifficulty(difficulty)
    const records = loadPreferences(difficulty)
    const next = { ...records, audio: preferencesRef.current.audio, reducedMotion: preferencesRef.current.reducedMotion }
    preferencesRef.current = next; setPreferences(next)
  }
  const begin = () => {
    readyRef.current = false; setReady(false)
    gameRef.current?.unlockAudio(); gameRef.current?.setPaused(false)
  }
  const restart = () => {
    resultSaved.current = false; setNewRecord(false)
    gameRef.current?.unlockAudio(); gameRef.current?.restart()
    overlayRef.current?.focus()
  }
  const resume = () => { gameRef.current?.unlockAudio(); gameRef.current?.setPaused(false) }

  const maxLives = livesFor(snapshot.difficulty)
  const infinite = !Number.isFinite(maxLives)

  return (
    <div ref={overlayRef} tabIndex={-1} className={`bug-hunt${snapshot.level === 0 ? ' bh-desk' : ''}${!ready && !snapshot.paused && !snapshot.gameOver && !snapshot.levelComplete && !snapshot.finished ? ' bh-playing' : ''}`} role="dialog" aria-modal="true" aria-label={copy.dialogLabel} data-bug-hunt onMouseDown={(event) => event.stopPropagation()}>
      <header className="bh-header">
        <div className="bh-brand"><span className="bh-brand-mark" aria-hidden>aO</span><div><strong>BUG HUNT</strong><small>{`${snapshot.level + 1} / 3 · ${LEVELS[snapshot.level].name.toUpperCase()}`}</small></div></div>
        <div className="bh-header-actions">
          <button className="bh-icon-button" aria-label={preferences.audio ? copy.audioOn : copy.audioOff} title={preferences.audio ? copy.audioOn : copy.audioOff} aria-pressed={preferences.audio} onClick={() => updatePreferences({ audio: !preferences.audio })}>{preferences.audio ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
          <button className="bh-icon-button" aria-label={copy.gentle} title={copy.gentleTitle} aria-pressed={preferences.reducedMotion} onClick={() => updatePreferences({ reducedMotion: !preferences.reducedMotion })}><Sparkles size={16} /></button>
          {!ready && !snapshot.finished && !snapshot.gameOver && !snapshot.levelComplete && <button className="bh-icon-button" aria-label={snapshot.paused ? copy.resume : copy.pause} title={copy.pauseTitle} onClick={() => snapshot.paused ? resume() : gameRef.current?.setPaused(true)}>{snapshot.paused ? <Play size={15} /> : <Pause size={15} />}</button>}
          <button className="bh-icon-button" aria-label={copy.backToApp} title={copy.backToApp} onClick={() => closeRef.current()}><X size={17} /></button>
        </div>
      </header>
      <div className="bh-stage">
        {/* The screen box matches the letterboxed canvas, so HUD corners sit on the game, not on the bars. */}
        <div className="bh-screen">
        {!ready && !snapshot.finished && !snapshot.gameOver && !snapshot.levelComplete && <div className={`bh-level-hint ${snapshot.rush.state === 'active' ? 'bh-rush' : ''}`}>
          {snapshot.rush.state === 'active' ? <><strong>{copy.rushLabel}</strong> {snapshot.rush.collected}/{RUSH_TARGET} · {Math.ceil(snapshot.rush.remaining)}s · +500 <progress max={8} value={snapshot.rush.remaining} /></> : snapshot.rush.state === 'won' ? copy.rushWon : (snapshot.level === 0 ? copy.deskHints[snapshot.deskBeat] : copy.stageHints[snapshot.level])}
        </div>}
        <canvas ref={canvasRef} width={WIDTH * 2} height={HEIGHT * 2} aria-label={copy.canvasLabel} />
        {!ready && <div className="bh-hud" aria-label={copy.hudLabel}>
          <div className="bh-hud-left">
            <div className={`bh-frame bh-player ${snapshot.health === 1 ? 'bh-low' : ''}`} aria-label={infinite ? copy.infiniteLives : copy.healthLabel(snapshot.health, maxLives)}>
              <img className="bh-avatar" src={avatarUrl} alt="" width={40} height={40} />
              <span className="bh-name">a0</span>
              <span className="bh-heart">{infinite ? '♥ ∞' : '♥'.repeat(snapshot.health)}<span className="bh-heart-empty">{infinite ? '' : '♥'.repeat(Math.max(0, maxLives - snapshot.health))}</span></span>
            </div>
            {/* Only what is live right now: tools in hand, timers, threats. Key hints live in the start menu. */}
            <div className="bh-status">
              {snapshot.shield && <span className="bh-pill sky" title={copy.powerShield}>◇ Shield</span>}
              {snapshot.branchJump > 0 && <span className="bh-pill sky" title={copy.powerJump}>↑ {snapshot.branchJump}s</span>}
              {snapshot.mergeBoost > 0 && <span className="bh-pill sun" title={copy.powerBoost}>» {snapshot.mergeBoost}s</span>}
              {snapshot.weapon === 'shuriken' && <span className="bh-pill sky" title={copy.fireHint}><kbd>F</kbd>{`{} ×${snapshot.ammo}`}</span>}
              {snapshot.revertCharges > 0 && <span className="bh-pill sky" title={copy.keysRevert}><kbd>R</kbd>↺ ×{snapshot.revertCharges}</span>}
              {snapshot.breakpoint > 0 && <span className="bh-pill rose">⏸ {snapshot.breakpoint}s</span>}
              {snapshot.sudo > 0 && <span className="bh-pill sun"># SUDO {snapshot.sudo}s</span>}
              {snapshot.purge === 'active' && <span className="bh-pill rose">{copy.purgeLabel}</span>}
              {snapshot.bossCommand && <span className={`bh-pill ${snapshot.bossAnnounce ? 'rose' : 'sun'}`} title={copy.bossCmdHint[snapshot.bossCommand]}>{copy.bossCmd[snapshot.bossCommand]}</span>}
              {snapshot.hotfix && <span className="bh-pill mint"><Cpu size={13} />{copy.hotfixFound}</span>}
            </div>
          </div>
          <div className="bh-frame bh-counters">
            <span title={copy.statBits}><Box size={19} strokeWidth={1.6} />{snapshot.bits} / {snapshot.totalBits}</span>
            <i aria-hidden />
            <span title={copy.statScore}><Settings size={19} strokeWidth={1.6} />{snapshot.score}{snapshot.combo >= 4 && <b className="bh-combo">x{Math.min(5, 1 + Math.floor(snapshot.combo / 4))}</b>}</span>
          </div>
        </div>}
        {!ready && <div className="bh-zone" aria-hidden>{`${LEVELS[snapshot.level].name.toUpperCase()}  //  ZONE ${snapshot.level + 1}-${snapshot.commit + 1}`}</div>}
        </div>
        {(ready || snapshot.paused || snapshot.gameOver || snapshot.finished || snapshot.levelComplete) && <div className="bh-modal">
          <div className="bh-card">
            <div className="bh-eyebrow"><span className="bh-dot" />{ready ? copy.introEyebrow : snapshot.gameOver ? 'GAME OVER' : snapshot.finished ? copy.winEyebrow : snapshot.levelComplete ? copy.stageClear : copy.pauseEyebrow}</div>
            {ready ? <>
              <h1>{copy.introTitle}<em>{copy.introTitleAccent}</em></h1>
              <p className="bh-quote">{copy.introQuote}</p>
              <p>{copy.introBody}</p>
              <div className="bh-mission"><Cpu size={21} /><div><strong>{copy.goalTitle}</strong><span>{copy.goalBody}</span></div></div>
              <div className="bh-difficulty" role="group" aria-label={copy.difficultyLabel}>
                {DIFFICULTIES.map(difficulty => <button key={difficulty} type="button" aria-pressed={snapshot.difficulty === difficulty} onClick={() => chooseDifficulty(difficulty)}><strong>{copy.difficultyNames[difficulty]}</strong><span>{difficulty === 'development' ? '♥ ∞' : '♥'.repeat(livesFor(difficulty))}</span></button>)}
              </div>
              <div className="bh-brief">
                <div className="bh-brief-block">
                  <h2>{copy.controlsTitle}</h2>
                  <dl className="bh-keygrid">
                    <dt><kbd>A</kbd><kbd>D</kbd></dt><dd>{copy.keysMove}</dd>
                    <dt><kbd>C</kbd></dt><dd>{copy.keysSlide}</dd>
                    <dt><kbd>{copy.keySpace}</kbd></dt><dd>{copy.keysJump}</dd>
                    <dt><kbd>X</kbd></dt><dd>{copy.keysDash}</dd>
                    <dt><kbd>F</kbd></dt><dd>{copy.keysFire}</dd>
                    <dt><kbd>S</kbd></dt><dd>{copy.keysCrouch}</dd>
                    <dt><kbd>W</kbd>+<kbd>F</kbd></dt><dd>{copy.keysAimUp}</dd>
                    <dt><kbd>E</kbd></dt><dd>{copy.keysGrapple}</dd>
                    <dt><kbd>R</kbd></dt><dd>{copy.keysRevert}</dd>
                  </dl>
                </div>
                <div className="bh-brief-block">
                  <h2>{copy.livesLabel}</h2>
                  <p className="bh-lives-row"><span className="bh-heart">{infinite ? '♥ ∞' : '♥'.repeat(maxLives)}</span></p>
                  <p>{infinite ? copy.infiniteRule : copy.finiteRule}</p>
                </div>
              </div>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={begin}>{copy.start} <ArrowRight size={15} /></button></div>
              <p className="bh-tip">{copy.powersIntro}{preferences.bestScore > 0 && ` ${copy.statScore}: ${preferences.bestScore}.`}{preferences.bestSeconds !== null && copy.record(formatTime(preferences.bestSeconds))}</p>
            </> : snapshot.gameOver ? <>
              <h1>{copy.gameOverTitle}</h1>
              <p>{copy.gameOverBody}</p>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={restart}><RotateCcw size={14} />{copy.restart}</button><button className="bh-secondary" onClick={() => closeRef.current()}>{copy.backToWork}</button></div>
            </> : snapshot.levelComplete ? <>
              <h1>{copy.stageClear}<em>{LEVELS[snapshot.level].name}</em></h1>
              <p>{copy.stageHints[snapshot.level + 1]}</p>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={() => { gameRef.current?.unlockAudio(); gameRef.current?.advance() }}>{copy.nextLevel}: {LEVELS[snapshot.level + 1].name} <ArrowRight size={15} /></button></div>
            </> : snapshot.finished ? <>
              <div className="bh-rank" aria-label={`${copy.rank} ${rankForScore(snapshot.score)}`}>{rankForScore(snapshot.score)}</div><h1>{copy.winTitle}<em>{copy.winTitleAccent}</em></h1>
              <p>{copy.winBody}</p>
              <div className="bh-stats"><div className="bh-stat"><strong>{snapshot.score}</strong><span>{copy.statScore}</span></div><div className="bh-stat"><strong>{formatTime(snapshot.seconds)}</strong><span>{copy.statTime}</span></div><div className="bh-stat"><strong>{snapshot.bits}/{snapshot.totalBits}</strong><span>{copy.statBits}</span></div><div className="bh-stat"><strong>{snapshot.deaths}</strong><span>{copy.statDeaths}</span></div></div>
              <span className="bh-medal">{copy.rushMedal}: {snapshot.rushWins}/3</span>
              <span className="bh-medal">{copy.statCombo}: {snapshot.bestCombo}</span>
              {newRecord && <span className="bh-medal"><Trophy size={12} />{copy.medalRecord}</span>}
              {snapshot.secret && <span className="bh-medal"><Sparkles size={12} />{copy.medalSecret}</span>}
              {snapshot.bugs === snapshot.totalBugs && <span className="bh-medal"><Check size={12} />{copy.medalBugs}</span>}
              <p className="bh-quote">{copy.winQuote}</p>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={restart}><RotateCcw size={14} />{copy.playAgain}</button><button className="bh-secondary" onClick={() => closeRef.current()}>{copy.backToWork}</button></div>
            </> : <>
              <h1>{copy.pauseTitle1}<em>{copy.pauseTitle2}</em></h1>
              <p>{snapshot.checkpoint ? copy.pauseBodyCheckpoint : copy.pauseBody}</p>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={resume}><Play size={14} />{copy.resume}</button><button className="bh-secondary" onClick={restart}><RotateCcw size={14} />{copy.restart}</button><button className="bh-secondary" onClick={() => closeRef.current()}>{copy.exit}</button></div>
              <p className="bh-tip">{copy.pauseTip}</p>
            </>}
          </div>
        </div>}
      </div>
      <footer className="bh-footer"><div className="bh-keys"><span><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> {copy.keysMove}</span><span><kbd>{copy.keySpace}</kbd> {copy.keysJump}</span><span><kbd>C</kbd> {copy.keysSlide}</span><span><kbd>X</kbd> / <kbd>Shift</kbd> {copy.keysDash}</span><span><kbd>F</kbd> {copy.keysFire}</span><span><kbd>S</kbd> / <kbd>↓</kbd> {copy.keysCrouch}</span><span><kbd>W</kbd>+<kbd>F</kbd> {copy.keysAimUp}</span><span><kbd>E</kbd> {copy.keysGrapple}</span>{snapshot.revertCharges > 0 && <span><kbd>R</kbd> {copy.keysRevert}</span>}<span><kbd>Esc</kbd> {copy.keysPause}</span></div><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Flag size={11} />{snapshot.checkpoint ? copy.checkpointSaved : copy.findCheckpoint}</span></footer>
    </div>
  )
}
