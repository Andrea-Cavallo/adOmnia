// Optional score challenge: failing never blocks progress or removes health.
export const RUSH_START = 1530
export const RUSH_END = 2420
export const RUSH_TARGET = 6
export const RUSH_SECONDS = 8
export const RUSH_BONUS = 500
export type Rush = { state: 'waiting' | 'active' | 'won' | 'missed'; remaining: number; collected: number }
export function createRush(): Rush { return { state: 'waiting', remaining: RUSH_SECONDS, collected: 0 } }
export function rankForScore(score: number): string { return score >= 8000 ? 'S' : score >= 4500 ? 'A' : score >= 2000 ? 'B' : 'C' }
