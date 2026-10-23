// Keeps a server snapshot from overwriting a toggle made while that snapshot was loading.
// Toggles run through trackMutation; list loads run through fetchSettled, which throws a
// snapshot away when a toggle started or finished meanwhile and loads it again once the
// toggles are done (that fetch starts after the write, so it already contains it).
let inflight = 0
let version = 0
let idleWaiters: Array<() => void> = []

export async function trackMutation<T>(p: Promise<T>): Promise<T> {
  inflight++
  version++
  try {
    return await p
  } finally {
    inflight--
    version++
    if (inflight === 0) {
      const waiters = idleWaiters
      idleWaiters = []
      waiters.forEach(w => w())
    }
  }
}

const idle = (): Promise<void> => (inflight === 0 ? Promise.resolve() : new Promise(resolve => { idleWaiters.push(resolve) }))

// Resolves with a snapshot no toggle overlapped, or null after `tries` overlaps: callers keep the
// local state then and the next refresh catches up.
export async function fetchSettled<T>(load: () => Promise<T>, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    await idle()
    const seen = version
    const result = await load()
    if (inflight === 0 && version === seen) return result
  }
  return null
}
