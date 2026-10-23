import type { MouseEvent } from 'react'

/**
 * Click handler of a modal backdrop. A click on the backdrop itself closes the dialog; a click that
 * comes from inside the dialog is stopped here, so it never reaches the React ancestors of the
 * backdrop (the dialog used to do this with its own `onClick={e => e.stopPropagation()}`, which made
 * a non-interactive element carry a click handler without a keyboard listener).
 */
export function closeOnBackdropClick(onClose: () => void): (event: MouseEvent<HTMLElement>) => void {
  return (event) => {
    if (event.target === event.currentTarget) onClose()
    else event.stopPropagation()
  }
}
