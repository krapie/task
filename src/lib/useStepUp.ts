import { useState, useEffect, useCallback, useRef } from 'react'
import { api, STEP_UP_EVENT, type StepUpView } from './api'

// Passkey step-up lock shared by the Assets and Health tabs. The tab itself
// renders without a passkey, but with placeholders only: the view must not
// fetch anything until `unlocked`, and `onLock` must drop every fetched value
// (not just mask it) so a locked tab holds nothing sensitive in memory.
//
// Locks on: the Lock button, the tab going to the background (no amounts in
// an app-switcher screenshot), and the end of the 1-hour passkey session. There
// is no idle lock and no refresh: unlocking again inside the hour re-mints a
// token that ends at the same moment; after it, a new passkey is needed.
export function useStepUp(view: StepUpView, isAuth: boolean, onLock: () => void) {
  const [unlocked, setUnlocked] = useState(() => api.assets.hasToken())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)
  const onLockRef = useRef(onLock)
  onLockRef.current = onLock
  const unlockedRef = useRef(unlocked)
  unlockedRef.current = unlocked

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
      setError('This account cannot view this data')
    } else {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [lock])

  // Another view unlocked or locked (the Assistant tab and its chat button share one state).
  useEffect(() => {
    const sync = () => {
      const has = api.assets.hasToken()
      if (has === unlockedRef.current) return
      setUnlocked(has)
      if (!has) onLockRef.current()
    }
    window.addEventListener(STEP_UP_EVENT, sync)
    return () => window.removeEventListener(STEP_UP_EVENT, sync)
  }, [])

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

// "59:59" for the step-up countdown chip.
export function formatRemaining(ms: number): string {
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}
