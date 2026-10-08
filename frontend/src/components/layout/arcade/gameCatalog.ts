import type { GameId } from './types'

export const GAME_TITLES: Record<GameId, string> = { snake: 'Snake', tictactoe: 'Tris', pong: 'Pong' }
export const GAME_IDS = Object.keys(GAME_TITLES) as GameId[]

