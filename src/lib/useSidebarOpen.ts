import { useCallback, useRef, useState } from 'react'

const PHONE_MAX = 600

// Open/closed state of a Mail/News sidebar, remembered in this browser per `key`.
// On phones the sidebar is a temporary overlay: it always starts closed, and opening it there never overwrites the desktop choice.
export function useSidebarOpen(key: string): [boolean, (next: boolean | ((open: boolean) => boolean)) => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    if (window.innerWidth <= PHONE_MAX) return false
    try {
      if (localStorage.getItem(key) === '0') return false
    } catch {
      /* private mode */
    }
    return true
  })
  const latest = useRef(open)
  latest.current = open

  const setOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(latest.current) : next
    latest.current = value
    setOpenState(value)
    if (window.innerWidth <= PHONE_MAX) return
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      /* private mode */
    }
  }, [key])

  return [open, setOpen]
}
