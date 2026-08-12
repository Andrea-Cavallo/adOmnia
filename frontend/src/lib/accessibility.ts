import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const modalStack: symbol[] = []

export interface FocusRect {
  left: number
  top: number
  right: number
  bottom: number
}

function center(rect: FocusRect): { x: number; y: number } {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

/** Finds the nearest visible control in an arrow-key direction. */
export function findSpatialFocusIndex(targets: readonly FocusRect[], originIndex: number, key: string): number | null {
  if (targets.length === 0) return null
  if (originIndex < 0 || originIndex >= targets.length) return 0
  const origin = center(targets[originIndex])
  let winner: { index: number; score: number } | null = null

  for (let index = 0; index < targets.length; index += 1) {
    if (index === originIndex) continue
    const candidate = center(targets[index])
    const dx = candidate.x - origin.x
    const dy = candidate.y - origin.y
    const primary = key === 'ArrowUp' || key === 'ArrowDown' ? Math.abs(dy) : Math.abs(dx)
    const secondary = key === 'ArrowUp' || key === 'ArrowDown' ? Math.abs(dx) : Math.abs(dy)
    const isInDirection = (key === 'ArrowUp' && dy < 0)
      || (key === 'ArrowDown' && dy > 0)
      || (key === 'ArrowLeft' && dx < 0)
      || (key === 'ArrowRight' && dx > 0)
    if (!isInDirection) continue
    const score = primary * 4 + secondary
    if (!winner || score < winner.score) winner = { index, score }
  }
  return winner?.index ?? null
}

export function focusableElements(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
}

/**
 * Returns the next item in a roving-focus group. Arrow navigation wraps so a
 * compact desktop toolbar or menu never becomes a dead end for keyboard users.
 */
export function nextRovingFocusIndex(currentIndex: number, itemCount: number, key: string): number | null {
  if (itemCount <= 0) return null
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (currentIndex + 1 + itemCount) % itemCount
    case 'ArrowUp':
    case 'ArrowLeft':
      return (currentIndex - 1 + itemCount) % itemCount
    case 'Home':
      return 0
    case 'End':
      return itemCount - 1
    default:
      return null
  }
}

export function handleKeyboardActivation(
  event: KeyboardEvent<HTMLElement>,
  action: () => void,
): void {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

type ModalKeyboardEvent = Pick<globalThis.KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>

export function handleModalKeyboard(
  event: ModalKeyboardEvent,
  container: HTMLElement | null,
  onClose: () => void,
  activeElement: Element | null = typeof document === 'undefined' ? null : document.activeElement,
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    onClose()
    return
  }
  if (event.key !== 'Tab' || !container) return

  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Gives desktop dialogs predictable keyboard behaviour: Escape closes, Tab is
 * trapped inside the surface, and focus returns to the invoking control.
 */
export function useModalFocusTrap(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
): void {
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const modalToken = Symbol('modal')
    modalStack.push(modalToken)
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const focusFirst = () => {
      const container = containerRef.current
      if (!container) return
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(first ?? container).focus()
    }
    const animationFrame = requestAnimationFrame(focusFirst)

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== modalToken) return
      handleModalKeyboard(event, containerRef.current, () => onCloseRef.current())
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(animationFrame)
      document.removeEventListener('keydown', handleKeyDown)
      const stackIndex = modalStack.lastIndexOf(modalToken)
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1)
      const previous = previousFocusRef.current
      requestAnimationFrame(() => previous?.focus())
    }
  }, [containerRef, open])
}
