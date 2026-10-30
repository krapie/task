// node --test test/
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import express from 'express'
import { duration, telemetry } from '../server/telemetry.js'
import { sanitize } from '../server/tracing.js'

const get = (port, path) =>
  new Promise((resolve) => http.get({ port, path }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) }))

test('route label is the pattern, probes are skipped, 5xx is its own class', async () => {
  const app = express()
  app.use(telemetry)
  app.get('/api/todos/:id', (_req, res) => res.status(500).end())
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  const srv = app.listen(0)
  const { port } = srv.address()
  await get(port, '/api/todos/abc?token=SECRET')
  await get(port, '/api/todos/def')
  await get(port, '/wp-login.php')
  await get(port, '/api/health')
  await new Promise((r) => setTimeout(r, 50))
  srv.close()
  const rows = (await duration.get()).values.filter((v) => v.metricName === 'http_server_request_duration_seconds_count')
  const keys = rows.map((v) => `${v.labels.route} ${v.labels.code}=${v.value}`).sort()
  assert.deepEqual(keys, ['/api/todos/:id 5xx=2', 'unmatched 4xx=1'])
})

test('sanitize strips query strings and SQL text', () => {
  const s = sanitize({ attributes: { 'url.full': 'http://x/y?key=SECRET', 'http.target': '/a?b=1', 'db.statement': 'SELECT 1', 'db.system': 'postgresql' } })
  assert.equal(s.attributes['url.full'], 'http://x/y')
  assert.equal(s.attributes['http.target'], '/a')
  assert.equal(s.attributes['db.statement'], undefined)
  assert.equal(s.attributes['db.system'], 'postgresql')
})

test('sanitize drops database error text from events and status', () => {
  const span = {
    attributes: {},
    status: { code: 2, message: 'duplicate key value violates unique constraint: Key (email)=(a@b.c) already exists' },
    events: [{ name: 'exception', attributes: { 'exception.type': 'error', 'exception.message': 'Key (email)=(a@b.c)', 'exception.stacktrace': 'Error: Key (email)=(a@b.c)\n at x' } }],
  }
  sanitize(span)
  assert.equal(span.status.code, 2)
  assert.equal(span.status.message, undefined)
  assert.equal(span.events[0].attributes['exception.type'], 'error')
  assert.ok(!JSON.stringify(span).includes('a@b.c'))
})
