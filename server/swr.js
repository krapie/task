// A small stale-while-revalidate cache for reads that are slow or cross a service boundary (health view, trader summary,
// assets summary). A value younger than freshMs is returned as it is; an older one up to staleMs is returned at once while
// one reload runs in the background; an expired or missing one waits for the load. Concurrent loads of a key share one call.
// A failed background reload keeps the old value; a failed load with no value throws. invalidate drops the value and
// forgets a load in flight, so a read that started before a write cannot put its old answer back.
export function createSwr({ freshMs, staleMs, now = Date.now }) {
  const entries = new Map() // key -> { value, at }
  const loads = new Map() // key -> promise

  function load(key, loader) {
    let p = loads.get(key)
    if (!p) {
      p = Promise.resolve()
        .then(loader)
        .then((value) => {
          if (loads.get(key) === p) entries.set(key, { value, at: now() })
          return value
        })
        .finally(() => {
          if (loads.get(key) === p) loads.delete(key)
        })
      loads.set(key, p)
    }
    return p
  }

  return {
    async get(key, loader) {
      const e = entries.get(key)
      const age = e ? now() - e.at : Infinity
      if (age < freshMs) return e.value
      if (age < staleMs) {
        load(key, loader).catch(() => {})
        return e.value
      }
      return load(key, loader)
    },
    invalidate(key) {
      entries.delete(key)
      loads.delete(key)
    },
  }
}
