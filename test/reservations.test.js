import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canMove, jobFromInput, kstDate, pushFor } from '../server/reservations.js'

const DOMAINS = ['catchtable.co.kr', 'catchtable.net', 'naver.com']
const base = { shop_name: '고디바 롯데월드몰점', shop_url: 'https://app.catchtable.co.kr/ct/shop/godiva_lotteworldmall', party: 1, slots: ['10:30', '16:30', '12:30'], open_time: '09:00' }
const at = (s) => new Date(s) // KST 08:00 on 2026-11-19 = 2026-11-18T23:00:00Z

test('a job: slots keep the owner\'s priority, the day defaults to the next opening, fire_at is KST', () => {
  const j = jobFromInput(base, DOMAINS, at('2026-11-18T23:00:00Z'))
  assert.deepEqual(j.slots, ['10:30', '16:30', '12:30'], 'the order given')
  assert.deepEqual(jobFromInput({ ...base, slots: ['12:30', '14:30', '12:30', '16:30'] }, DOMAINS, at('2026-11-18T23:00:00Z')).slots, ['12:30', '14:30', '16:30'], 'lunch first, once each')
  assert.equal(j.date, '2026-11-19')
  assert.equal(j.fire_at, '2026-11-19T00:00:00.000Z') // 09:00 KST
  assert.equal(j.mode, 'live')
  // after today's opening (+ the window) the next one is tomorrow's
  assert.equal(jobFromInput(base, DOMAINS, at('2026-11-19T01:00:00Z')).date, '2026-11-20') // 10:00 KST, 60 min after the opening
  // within the window of today's opening: still today
  assert.equal(jobFromInput(base, DOMAINS, at('2026-11-19T00:05:00Z')).date, '2026-11-19')
})

test('only a listed Catch Table address, a small party, real times', () => {
  const now = at('2026-11-18T23:00:00Z')
  assert.throws(() => jobFromInput({ ...base, shop_url: 'http://app.catchtable.co.kr/x' }, DOMAINS, now), /https/)
  assert.throws(() => jobFromInput({ ...base, shop_url: 'https://www.naver.com/' }, DOMAINS, now), /Catch Table only/)
  assert.throws(() => jobFromInput({ ...base, shop_url: 'https://app.catchtable.co.kr/x' }, ['naver.com'], now), /site list/)
  assert.throws(() => jobFromInput({ ...base, shop_url: 'https://catchtable.co.kr.evil.example/x' }, DOMAINS, now), /site list/)
  assert.throws(() => jobFromInput({ ...base, party: 0 }, DOMAINS, now), /party/)
  assert.throws(() => jobFromInput({ ...base, party: 7 }, DOMAINS, now), /party/)
  assert.throws(() => jobFromInput({ ...base, slots: [] }, DOMAINS, now), /slots/)
  assert.throws(() => jobFromInput({ ...base, slots: ['25:00'] }, DOMAINS, now), /slots/)
  assert.throws(() => jobFromInput({ ...base, open_time: '9am' }, DOMAINS, now), /open_time/)
  assert.throws(() => jobFromInput({ ...base, shop_name: '' }, DOMAINS, now), /shop_name/)
})

test('a past opening and a far one are refused; dry_run is a mode', () => {
  const now = at('2026-11-19T02:00:00Z') // 11:00 KST
  assert.throws(() => jobFromInput({ ...base, date: '2026-11-19' }, DOMAINS, now), /already passed/)
  assert.throws(() => jobFromInput({ ...base, date: '2026-11-25' }, DOMAINS, now), /3 days/)
  assert.throws(() => jobFromInput({ ...base, date: '2026-13-40' }, DOMAINS, now), /calendar|YYYY/)
  assert.equal(jobFromInput({ ...base, mode: 'dry_run' }, DOMAINS, now).mode, 'dry_run')
  assert.equal(jobFromInput({ ...base, mode: 'anything' }, DOMAINS, now).mode, 'live')
})

test('state changes only forward', () => {
  assert.ok(canMove('scheduled', 'preparing') && canMove('preparing', 'running') && canMove('running', 'succeeded'))
  assert.ok(canMove('scheduled', 'cancelled') && canMove('running', 'dry_run_done'))
  assert.ok(!canMove('succeeded', 'running') && !canMove('cancelled', 'scheduled') && !canMove('scheduled', 'succeeded') && !canMove('failed', 'running'))
})

test('the owner is told how a job ended', () => {
  const job = { shop_name: '고디바 롯데월드몰점', date: '2026-11-19', open_time: '09:00', party: 1, result: { time: '16:30', booking_number: '1411125955', detail: 'sold out' } }
  assert.match(pushFor(job, 'succeeded').title, /예약 완료/)
  assert.match(pushFor(job, 'succeeded').body, /16:30.*1411125955/)
  assert.match(pushFor(job, 'failed').body, /sold out/)
  assert.match(pushFor(job, 'expired').body, /09:00/)
  assert.equal(pushFor(job, 'preparing'), null)
  assert.equal(kstDate(at('2026-11-18T16:00:00Z')), '2026-11-19')
})
