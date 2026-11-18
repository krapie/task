import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedDomains, duplicateOf, MAX_ALLOWED_DOMAINS, normalizeDomain, SEED_SITES, siteChanges, siteFromInput, tooManyDomains } from '../server/browser-sites.js'

test('a domain is one site: never a suffix, an address, the owner\'s consoles or a private name', () => {
  assert.equal(normalizeDomain(' Shop.Example.COM '), 'shop.example.com')
  assert.equal(normalizeDomain('gov.kr'), 'gov.kr')
  for (const bad of ['com', 'co.kr', 'go.kr', 'gov.uk', 'github.io', 'blogspot.com', '10.0.0.1', 'localhost', 'admin.kevinprk.com', 'x.cluster.local', 'https://a.com', 'a.com/x', '*.a.com', '', null]) assert.throws(() => normalizeDomain(bad), undefined, String(bad))
})

test('a new site: https only, domain defaults to the host without www, the address must be on its domains', () => {
  const s = siteFromInput({ label: ' Shop ', url: 'https://www.shop.example.com/login#top', login_domains: ['accounts.example.net'] })
  assert.deepEqual(s, { label: 'Shop', url: 'https://www.shop.example.com/login', domains: ['shop.example.com'], login_domains: ['accounts.example.net'], note: '', quick_link: true })
  assert.throws(() => siteFromInput({ label: 'x', url: 'http://shop.example.com/' }), /https/)
  assert.throws(() => siteFromInput({ label: 'x', url: 'https://user:pw@shop.example.com/' }), /user name/)
  assert.throws(() => siteFromInput({ label: 'x', url: 'https://shop.example.com/', domains: ['other.example.com'] }), /not on any/)
  assert.throws(() => siteFromInput({ label: '', url: 'https://shop.example.com/' }), /label/)
  assert.throws(() => siteFromInput({ label: 'x', url: 'https://www.co.kr/' }), /public suffix/)
  assert.throws(() => siteFromInput({ label: 'x', url: 'https://admin.kevinprk.com/' }), /own domain/)
})

test('changes check only what is present and keep the address on its domains', () => {
  const cur = { url: 'https://a.example.com/', domains: ['example.com'], login_domains: [] }
  assert.deepEqual(siteChanges({ note: ' hi ', quick_link: 0, enabled: true }, cur), { note: 'hi', quick_link: false, enabled: true })
  assert.deepEqual(siteChanges({ login_status: 'needs_login' }, cur), { login_status: 'needs_login' })
  assert.throws(() => siteChanges({ login_status: 'maybe' }, cur), /login_status/)
  assert.throws(() => siteChanges({ url: 'https://other.org/' }, cur), /not on any/)
  assert.throws(() => siteChanges({ domains: [] }, cur), /at least one/)
})

test('the allowed list is the enabled sites\' domains and sign-in domains, once each', () => {
  const rows = [
    { enabled: true, domains: ['a.com', 'b.com'], login_domains: ['kakao.com'] },
    { enabled: true, domains: ['kakao.com'], login_domains: [] },
    { enabled: false, domains: ['off.com'], login_domains: ['off-login.com'] },
  ]
  assert.deepEqual(allowedDomains(rows), ['a.com', 'b.com', 'kakao.com'])
  assert.deepEqual(allowedDomains(SEED_SITES.map(s => ({ enabled: true, login_domains: [], ...s }))), ['catchtable.co.kr', 'catchtable.net', 'coupang.com', 'kakao.com', 'naver.com'])
})

test('a site that repeats a label or an own domain is a duplicate; a sign-in domain is not', () => {
  const rows = [{ id: 'a', label: 'Catch Table', domains: ['catchtable.co.kr'], login_domains: ['kakao.com'], enabled: true }, { id: 'b', label: 'Kakao', domains: ['kakao.com'], login_domains: [], enabled: true }]
  assert.equal(duplicateOf(rows, { label: 'catch table', domains: ['x.com'] }).id, 'a')
  assert.equal(duplicateOf(rows, { label: 'Other', domains: ['catchtable.co.kr'] }).id, 'a')
  assert.equal(duplicateOf(rows, { label: 'Shop', domains: ['shop.example.com'], login_domains: ['kakao.com'] }), null)
})

test('the union of allowed domains stays within what the worker takes', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, label: `s${i}`, domains: Array.from({ length: 20 }, (_, j) => `d${i}-${j}.example.com`), login_domains: [], enabled: true }))
  assert.equal(allowedDomains(rows).length, 200)
  assert.equal(MAX_ALLOWED_DOMAINS, 200)
  assert.equal(tooManyDomains(rows, { id: 'new', domains: ['one-more.example.com'], login_domains: [] }), true)
  assert.equal(tooManyDomains(rows, { id: 'r0', domains: ['only.example.com'], login_domains: [] }), false, 'changing a site replaces its domains')
})
