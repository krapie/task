import assert from 'node:assert/strict'
import { test } from 'node:test'
import { poolOptions, warmPool } from '../server/pool.js'

test('idle connections are kept, with a connect and a statement ceiling (architecture.md, "Database clients")', () => {
  const o = poolOptions('postgres://u:p@h/db', { max: 8, application_name: 'x' })
  assert.equal(o.idleTimeoutMillis, 0)
  assert.equal(o.max, 8)
  assert.equal(o.connectionTimeoutMillis, 5_000)
  assert.equal(o.statement_timeout, 15_000)
  assert.equal(o.maxLifetimeSeconds, 6 * 3600)
  assert.equal(o.keepAlive, true)
  assert.equal(o.application_name, 'x')
  assert.equal(poolOptions('u', { max: 2, application_name: 'y', statement_timeout: 30_000 }).statement_timeout, 30_000)
})

test('warmPool asks for n connections at once and counts those that opened', async () => {
  let open = 0
  let peak = 0
  let calls = 0
  const pool = {
    query: async () => {
      const n = ++calls
      open++
      peak = Math.max(peak, open)
      await new Promise((r) => setTimeout(r, 5))
      open--
      if (n === 2) throw new Error('refused')
    },
  }
  assert.equal(await warmPool(pool, 4), 3)
  assert.equal(peak, 4)
})
