// Count of API requests in flight; drives the thin progress bar under the top edge.
let n = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export const inflightStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  get: () => n,
}

export async function trackInflight<T>(p: Promise<T>): Promise<T> {
  n++
  emit()
  try {
    return await p
  } finally {
    n--
    emit()
  }
}
