export const DIFFICULTIES = ['development', 'testing', 'production'] as const
export type Difficulty = typeof DIFFICULTIES[number]
export const livesFor = (difficulty: Difficulty) => difficulty === 'development' ? Infinity : difficulty === 'testing' ? 4 : 3
