import { useEffect, useRef, type ReactNode } from 'react'

export function CodeStudioChromeDisclosure({ className, label, title = label, icon, children }: { className: string; label: string; title?: string; icon: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(()=>{
    const dismiss = (event: PointerEvent) => {
      const details = ref.current
      if (!details?.open || !(event.target instanceof Element)) return
      if (!details.contains(event.target) && !event.target.closest('[role="menu"], [role="dialog"]')) details.open=false
    }
    document.addEventListener('pointerdown',dismiss)
    return ()=>document.removeEventListener('pointerdown',dismiss)
  },[])
  return (
    <details ref={ref} className={className} onKeyDown={event=>{
      if(event.key==='Escape' && event.currentTarget.contains(event.target as Node)) {
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.open=false
        event.currentTarget.querySelector('summary')?.focus()
      }
    }}>
      <summary aria-label={label} title={title}>{icon}</summary>
      {children}
    </details>
  )
}
