import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type StepUpView } from './api'

const IDLE_LOCK_MS = 5 * 60_000

// Passkey step-up lock shared by the Assets and Health tabs. The tab itself
// renders without a passkey, but with placeholders only: the view must not
// fetch anything until `unlocked`, and `onLock` must drop every fetched value
// (not just mask it) so a locked tab holds nothing sensitive in memory.
//
// Locks on: the Lock button, the tab going to the background (no amounts in
// an app-switcher screenshot), 5 minutes idle, and the token's 5-minute TTL.
export function useStepUp(view: StepUpView, isAuth: boolean, onLock: () => void) {
  const [unlocked, setUnlocked] = useState(() => api.assets.hasToken())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLockRef = useRef(onLock)
  onLockRef.current = onLock

  const lock = useCallback(() => {
    api.assets.clearToken()
    setUnlocked(false)
    onLockRef.current()
  }, [])

  const unlock = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await api.passkey.authenticate(view)
      setUnlocked(true)
    } catch (err) {
      if (err instanceof Error && err.message === 'REDIRECTING') return
      setError(err instanceof Error ? err.message : 'Passkey unlock failed')
    } finally {
      setBusy(false)
    }
  }, [view])

  // A failed data request: 401 relocks silently, 403 relocks with a message.
  const handleError = useCallback((err: unknown) => {
    if (err instanceof Error && err.message === 'ASSET_SESSION_EXPIRED') {
      lock()
    } else if (err instanceof Error && err.message === 'STEP_UP_FORBIDDEN') {
      lock()
      setError('이 계정으로는 볼 수 없습니다')
    } else {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [lock])

  // Coming back from the auth passkey prompt: finish the unlock without
  // another click, but only in the view that started it.
  useEffect(() => {
    if (isAuth && !unlocked && api.passkey.takeUnlockPending(view)) void unlock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth])

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) lock()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [lock])

  useEffect(() => {
    if (!unlocked) return
    function resetIdle() {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(lock, IDLE_LOCK_MS)
    }
    resetIdle()
    const events: (keyof DocumentEventMap)[] = ['mousemove', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => document.addEventListener(e, resetIdle))
    return () => {
      events.forEach(e => document.removeEventListener(e, resetIdle))
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [unlocked, lock])

  useEffect(() => {
    if (!unlocked) return
    const tick = () => {
      const ms = api.assets.remainingMs()
      setRemaining(ms)
      if (ms <= 0) lock()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [unlocked, lock])

  return { unlocked, busy, setBusy, error, setError, remaining, lock, unlock, handleError }
}

// "4:59" for the step-up countdown chip.
export function formatRemaining(ms: number): string {
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}
