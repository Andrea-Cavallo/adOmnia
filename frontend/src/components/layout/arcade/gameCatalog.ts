import type { GameId } from './types'

export const GAME_TITLES: Record<GameId, string> = { snake: 'Snake', tictactoe: 'Tris', pong: 'Pong', asteroids: 'Asteroids', bubble: 'Dot Bubble', racer: 'Glyph Racer' }
export const GAME_IDS = Object.keys(GAME_TITLES) as GameId[]

