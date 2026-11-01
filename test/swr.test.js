import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSwr } from '../server/swr.js'

const clock = () => {
  const c = { t: 0, now: () => c.t }
  return c
}
const flush = () => new Promise((r) => setImmediate(r))

test('a fresh value is served without a load, an older one is served while one load runs', async () => {
  const c = clock()
  const swr = createSwr({ freshMs: 100, staleMs: 1000, now: c.now })
  let n = 0
  const loader = async () => ++n
  assert.equal(await swr.get('k', loader), 1)
  c.t = 50
  assert.equal(await swr.get('k', loader), 1)
  assert.equal(n, 1)
  c.t = 200 // stale: old value now, new one later; two readers share one load
  assert.equal(await swr.get('k', loader), 1)
  assert.equal(await swr.get('k', loader), 1)
  await flush()
  assert.equal(n, 2)
  assert.equal(await swr.get('k', loader), 2)
})

test('an expired value waits for the load, and concurrent callers share it', async () => {
  const c = clock()
  const swr = createSwr({ freshMs: 100, staleMs: 1000, now: c.now })
  let n = 0
  const loader = async () => {
    await new Promise((r) => setTimeout(r, 5))
    return ++n
  }
  await swr.get('k', loader)
  c.t = 5000
  const [a, b] = await Promise.all([swr.get('k', loader), swr.get('k', loader)])
  assert.deepEqual([a, b, n], [2, 2, 2])
})

test('a failed reload keeps the old value, a failed first load throws', async () => {
  const c = clock()
  const swr = createSwr({ freshMs: 100, staleMs: 1000, now: c.now })
  await assert.rejects(swr.get('k', async () => { throw new Error('down') }), /down/)
  assert.equal(await swr.get('k', async () => 'v1'), 'v1')
  c.t = 200
  assert.equal(await swr.get('k', async () => { throw new Error('down') }), 'v1')
  await flush()
  c.t = 300
  assert.equal(await swr.get('k', async () => 'v2'), 'v1') // still stale, the failed reload left the value in place
})

test('invalidate drops the value and a load that started before it cannot put its answer back', async () => {
  const c = clock()
  const swr = createSwr({ freshMs: 100, staleMs: 1000, now: c.now })
  let release
  const slow = () => new Promise((r) => { release = r })
  const first = swr.get('k', slow) // a read in flight: it will return the answer from before the write
  await flush()
  swr.invalidate('k')
  release('old')
  assert.equal(await first, 'old')
  assert.equal(await swr.get('k', async () => 'new'), 'new') // not served from the old answer
})
