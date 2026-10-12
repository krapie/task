// API requests in flight, counted per scope (the first path segment: templates, news, mail, ...).
// Drives the thin progress bar under the top edge, which only listens to the scopes of the
// current tab so a background refresh elsewhere never flashes it.
const counts = new Map<string, number>()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach(l => l()) }

export const inflightStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  // Snapshot changes whenever any count changes; readers filter with busy().
  get: () => version,
}

export const busy = (scopes: readonly string[]) => scopes.some(s => (counts.get(s) ?? 0) > 0)

export async function trackInflight<T>(p: Promise<T>, scope: string): Promise<T> {
  counts.set(scope, (counts.get(scope) ?? 0) + 1)
  emit()
  try {
    return await p
  } finally {
    counts.set(scope, (counts.get(scope) ?? 1) - 1)
    emit()
  }
}
