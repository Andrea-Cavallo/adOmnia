import { describe, expect, it } from 'vitest'
import { CONSOLE_WINDOW, CONSOLE_WINDOW_STEP, MAX_RENDERED_LINES, consoleVisibleStart } from './goStudioConsoleWindow'

describe('consoleVisibleStart', () => {
  it('shows everything when the output fits the window', () => {
    expect(consoleVisibleStart(50, CONSOLE_WINDOW, false)).toEqual({ start: 0, hidden: 0 })
    expect(consoleVisibleStart(CONSOLE_WINDOW, CONSOLE_WINDOW, false)).toEqual({ start: 0, hidden: 0 })
  })

  it('keeps only the tail and counts the earlier lines', () => {
    expect(consoleVisibleStart(8000, CONSOLE_WINDOW, false)).toEqual({ start: 7000, hidden: 7000 })
    // La finestra cresce con "mostra precedenti" ma non oltre il cap delle righe disegnate.
    expect(consoleVisibleStart(8000, CONSOLE_WINDOW + CONSOLE_WINDOW_STEP, false)).toEqual({ start: 6000, hidden: 6000 })
    expect(consoleVisibleStart(8000, MAX_RENDERED_LINES * 2, false)).toEqual({ start: 3000, hidden: 3000 })
  })

  it('opens the window fully while searching, so old matches stay visible', () => {
    expect(consoleVisibleStart(8000, CONSOLE_WINDOW, true)).toEqual({ start: 3000, hidden: 3000 })
  })
})
