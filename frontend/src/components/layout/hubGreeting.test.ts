import { describe, expect, it } from 'vitest'
import { greeting, greetingPeriod } from './hubGreeting'
describe('Hub greetings', () => {
  it.each([[0,'night'], [4,'night'], [5,'morning'], [11,'morning'], [12,'afternoon'], [17,'afternoon'], [18,'evening'], [21,'evening'], [22,'late'], [23,'late']] as const)('uses the right period at %i:00', (hour, period) => {
    expect(greetingPeriod(hour)).toBe(period)
  })
  it('offers distinct phrases within each period', () => {
    for (const hour of [2, 9, 14, 19, 23]) expect(new Set([0,1,2].map(variant => greeting(hour,variant))).size).toBe(3)
  })
  it('changes period even with the same visit variant', () => {
    expect(greeting(9)).toBe('Good morning.')
    expect(greeting(19)).toBe('Good evening.')
    expect(greeting(23)).toBe('Still working?')
  })
})
