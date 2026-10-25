const GREETINGS = {
  morning: ['Good morning.', 'An early start.', 'What are we building today?'],
  afternoon: ['Good afternoon.', 'Ready for the next idea?', 'Where shall we start?'],
  evening: ['Good evening.', 'A little time to create.', 'One more idea?'],
  late: ['Still working?', 'One last thing?', 'A quiet moment to focus.'],
  night: ['Still working?', 'Up late?', 'The quiet hours.'],
} as const

export function greetingPeriod(hour: number): keyof typeof GREETINGS {
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'late'
}

export function greeting(hour: number, variant = 0): string {
  const phrases = GREETINGS[greetingPeriod(hour)]
  return phrases[Math.abs(Math.trunc(variant)) % phrases.length]
}
