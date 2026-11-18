import { useEffect, type RefObject } from 'react'

// Esc interrupts the agent while it answers. It listens on the window only while `active`, and only when the key
// is pressed with focus inside `scope` (or on the page itself), so an Esc meant for another dialog, select or
// editor is left alone. A key press that belongs to an IME composition or was already handled is ignored.
export function useEscToStop(active: boolean, onStop: () => void, scope?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || document.querySelector('.modal-overlay')) return
      const t = e.target as Node | null
      const inside = !scope?.current || t === document.body || t === document.documentElement || (t != null && scope.current.contains(t))
      if (!inside) return
      e.preventDefault()
      onStop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onStop, scope])
}
