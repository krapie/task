import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noteAccess } from '../server/notes-access.js'

const owners = new Set(['kevinprk'])
const tok = (over = {}) => ({ preferred_username: 'kevinprk', sub: 's1', ...over })

test('no token is none, a non-owner is forbidden even with a passkey', () => {
  assert.equal(noteAccess(null, owners).level, 'none')
  assert.equal(noteAccess(tok({ preferred_username: 'guest' }), owners).level, 'forbidden')
  assert.equal(noteAccess(tok({ preferred_username: 'guest', step_up: true, amr: ['hwk'] }), owners).level, 'forbidden')
})

test('an owner without the passkey sees visible notes only', () => {
  assert.equal(noteAccess(tok(), owners).level, 'visible')
  assert.equal(noteAccess(tok({ amr: ['pwd'] }), owners).level, 'visible')
})

test('step_up needs both the flag and a hardware-key amr', () => {
  assert.equal(noteAccess(tok({ step_up: true }), owners).level, 'visible')
  assert.equal(noteAccess(tok({ amr: ['hwk'] }), owners).level, 'visible')
  assert.equal(noteAccess(tok({ step_up: true, amr: 'hwk' }), owners).level, 'visible')
  const all = noteAccess(tok({ step_up: true, amr: ['hwk'] }), owners)
  assert.equal(all.level, 'all')
  assert.equal(all.username, 'kevinprk')
})
