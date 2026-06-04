import { useEffect } from 'react'
import { useTabsStore } from '@/stores/tabs'
import { useAppStore, RAIL_QUICK_NAV } from '@/stores/app'

export interface KeyboardShortcutsOptions {
  setCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void
}

export function useKeyboardShortcuts({ setCommandPaletteOpen }: KeyboardShortcutsOptions): void {
  const newTab        = useTabsStore((s) => s.newTab)
  const setActiveTab  = useTabsStore((s) => s.setActiveTab)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((open) => !open)
        return
      }
      if (mod && e.key === 'n') { e.preventDefault(); newTab(); return }
      if (mod && e.key === 's') { e.preventDefault(); document.dispatchEvent(new CustomEvent('adomnia:save-active-tab')); return }
      if (mod && e.key === ',') { e.preventDefault(); setActiveRail('settings'); return }
      // Cmd/Ctrl+1..9 → jump to each rail category's primary tool (visible rail order).
      if (mod && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        const target = RAIL_QUICK_NAV[Number(e.key) - 1]
        if (target) { e.preventDefault(); setActiveRail(target) }
        return
      }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); useAppStore.getState().toggleSidebar(); return }
      if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); document.dispatchEvent(new CustomEvent('adomnia:focus-url')); return }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setActiveRail('collections')
        // Defer so the collections rail/search input is mounted before focusing.
        setTimeout(() => document.dispatchEvent(new CustomEvent('adomnia:focus-search')), 0)
        return
      }
      if (mod && e.key.toLowerCase() === 'w') {
        const { activeTabId, closeTab } = useTabsStore.getState()
        if (activeTabId) { e.preventDefault(); closeTab(activeTabId) }
        return
      }
      if (mod && e.shiftKey && (e.key === ']' || e.key === '[')) {
        const { tabs, activeTabId, setActiveTab: setTab } = useTabsStore.getState()
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        if (idx !== -1 && tabs.length > 1) {
          e.preventDefault()
          const nextIdx = e.key === ']'
            ? (idx + 1) % tabs.length
            : (idx - 1 + tabs.length) % tabs.length
          setTab(tabs[nextIdx].id)
        }
        return
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
        const rail = useAppStore.getState().activeRail
        if (rail === 'collections') {
          e.preventDefault()
          const activeTabId = useTabsStore.getState().activeTabId
          if (activeTabId) useTabsStore.getState().duplicateTab(activeTabId)
        }
        return
      }
      if (import.meta.env.DEV && mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleDevTools(); return }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [newTab, setActiveRail, setCommandPaletteOpen, toggleDevTools])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      const { tabs, activeTabId } = useTabsStore.getState()
      if (tabs.length < 2) return
      const idx = tabs.findIndex((t) => t.id === activeTabId)
      if (idx === -1) return
      if (e.button === 3) { const prev = tabs[idx - 1]; if (prev) setActiveTab(prev.id) }
      else { const next = tabs[idx + 1]; if (next) setActiveTab(next.id) }
    }
    window.addEventListener('mousedown', handleMouseDown)
    return () => window.removeEventListener('mousedown', handleMouseDown)
  }, [setActiveTab])
}
