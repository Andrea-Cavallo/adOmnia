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

/** Composite widgets that own every arrow key, so spatial navigation must stay out. */
const ARROW_OWNING_ROLES = '[role="tree"], [role="menu"], [role="grid"], [role="listbox"], [role="slider"]'

/** Input types that hold no caret, so they have no arrow key to defend. */
const CARETLESS_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'reset', 'submit'])

/**
 * True when the focused control keeps an arrow key for itself instead of
 * handing it to spatial navigation. Anything that returns false here can be
 * walked past with the arrows, which is what makes the whole app traversable
 * top to bottom: only controls that would genuinely lose something keep a key.
 */
export function ownsArrowKey(element: Element | null, key: string): boolean {
  if (!element) return false
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
  const tag = element.tagName

  // Multi-line editors move a caret in all four directions.
  if (tag === 'TEXTAREA') return true
  if ((element as HTMLElement).isContentEditable || element.closest('[contenteditable="true"]')) return true

  // A closed <select> answers arrows by silently changing its value — a real
  // edit to the request. It gives up every arrow: open it with Enter or
  // Alt+ArrowDown, or type the first letters of an option.
  if (tag === 'SELECT') return false

  if (tag === 'INPUT') {
    const type = (element as HTMLInputElement).type
    if (type === 'range') return true
    // A single-line field has no vertical caret movement to lose.
    return CARETLESS_INPUT_TYPES.has(type) ? false : horizontal
  }

  if (element.closest(ARROW_OWNING_ROLES)) return true

  // A tablist owns only the arrows along its own orientation, so a horizontal
  // tab strip keeps ←/→ and releases ↑/↓ instead of being a dead end.
  const tablist = element.closest('[role="tablist"]')
  if (!tablist) return false
  return tablist.getAttribute('aria-orientation') === 'vertical'
    ? !horizontal
    : horizontal
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
