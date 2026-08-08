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
