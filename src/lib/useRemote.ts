import { useEffect, useState } from 'react'

// A request the Overview owns, refreshed every 5 minutes while the tab is visible. `enabled` false clears it
// (signing out, or a passkey lock), so one user's data never lingers for the next.
export function useRemote<T>(enabled: boolean, load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({ data: null, failed: false })
  useEffect(() => {
    if (!enabled) { setState({ data: null, failed: false }); return }
    let live = true
    const run = () => load().then(
      data => { if (live) setState({ data, failed: false }) },
      () => { if (live) setState(s => ({ ...s, failed: true })) },
    )
    let last = Date.now()
    const tick = () => { last = Date.now(); run() }
    run()
    const id = setInterval(() => { if (!document.hidden) tick() }, 5 * 60 * 1000)
    // A tab that sat in the background skipped its ticks: catch up when it is shown again.
    const onShow = () => { if (!document.hidden && Date.now() - last > 5 * 60 * 1000) tick() }
    document.addEventListener('visibilitychange', onShow)
    return () => { live = false; clearInterval(id); document.removeEventListener('visibilitychange', onShow) }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}
