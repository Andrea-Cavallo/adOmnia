import type { CodeStudioCommandId } from './codeStudioCommands'

/** Tasti laterali del mouse (MouseEvent.button 3 = indietro, 4 = avanti), come in IntelliJ e VS Code. */
export function mouseNavigationCommand(button: number): Extract<CodeStudioCommandId, 'nav.back' | 'nav.forward'> | null {
  if (button === 3) return 'nav.back'
  if (button === 4) return 'nav.forward'
  return null
}
