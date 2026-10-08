// Shared contract for the Hub's dot-matrix mini games. A game never touches the
// DOM: it only says which dots are lit; DotArcade owns the grid, colors, keys,
// pause, score bar and best score, so every game looks and feels the same.

export type GameId = 'snake' | 'tictactoe' | 'pong' | 'asteroids' | 'bubble' | 'racer'
export type GameKey = 'up' | 'down' | 'left' | 'right' | 'action'
/** ink = text color, soft = dimmed text color, accent = palette color. */
export type Ink = 'ink' | 'soft' | 'accent' | 'bubble0' | 'bubble1' | 'bubble2'

export interface Painter {
  /** Lights the dot nearest to (x, y) in grid cells; size scales the dot (1 = normal). */
  bubble?(x: number, y: number, kind: number): void
  dot(x: number, y: number, ink?: Ink, size?: number): void
}

export interface GameStatus {
  score: number
  over: boolean
  /** Shown when the round is over (e.g. "You win"). */
  message?: string
}

export interface DotGame<S> {
  id: GameId
  title: string
  /** Controls hint, shown before the first move. */
  help: string
  /** Real-time games can be paused; turn-based ones cannot. */
  realtime: boolean
  /** False for games that animate only while their state changes. */
  continuous?: boolean
  init(cols: number, rows: number): S
  press(state: S, key: GameKey): S
  update(state: S, dt: number, held: ReadonlySet<GameKey>): S
  draw(state: S, paint: Painter, time: number): void
  status(state: S): GameStatus
  /** A click on a grid cell (optional). */
  pointer?(state: S, x: number, y: number): S
  /** Next round after a game over; defaults to a fresh init. */
  next?(state: S): S
}

export const wrap = (v: number, size: number) => ((v % size) + size) % size
