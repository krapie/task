// The sites the Assistant's browser may use (docs/apps/browser-agent.md, "Sites"). The owner adds and removes them in the
// Browser panel; the assistant can only propose one (a card) and report a sign-in state. The domain rules are the same as
// the worker's (apps/browser-worker/src/policy.js normalizeDomain): keep the two in step.

// gov.kr (정부24) is a registrable domain, go.kr is the suffix: 'gov' is not in the list.
const CC_SECOND_LEVEL = new Set(['co', 'or', 'go', 'ne', 'ac', 're', 'pe', 'hs', 'ms', 'es', 'kg', 'com', 'net', 'org', 'edu', 'ltd', 'plc'])
// Hosting platforms where every tenant is a different owner: the platform itself is never "one site" (a tenant, like x.github.io, is).
const SHARED_HOSTS = new Set(['github.io', 'gitlab.io', 'blogspot.com', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'notion.site', 'wixsite.com', 'tistory.com', 'wordpress.com', 'weebly.com', 'sites.google.com', 'myshopify.com', 'ngrok.io', 'trycloudflare.com'])
const PRIVATE_SUFFIX = /(^|\.)(localhost|local|internal|lan|home\.arpa|svc|cluster\.local|corp|intranet)$/
const OWN_DOMAIN = /(^|\.)kevinprk\.com$/

export function normalizeDomain(input) {
  const d = String(input ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,20})$/.test(d)) throw new Error(`"${input}" is not a domain (use a bare name like example.com)`)
  const labels = d.split('.')
  if (labels.length === 2 && CC_SECOND_LEVEL.has(labels[0]) && labels[1].length === 2) throw new Error(`"${d}" is a public suffix, not one site`)
  if (labels.length === 2 && labels[0] === 'gov' && labels[1] !== 'kr') throw new Error(`"${d}" is a government suffix, not one site`)
  if (SHARED_HOSTS.has(d)) throw new Error(`"${d}" is a hosting platform, not one site (a tenant like name.${d} is fine)`)
  if (OWN_DOMAIN.test(d)) throw new Error("the owner's own domain is not a site for the browser")
  if (PRIVATE_SUFFIX.test(d)) throw new Error(`"${d}" looks like a private name`)
  return d
}

const domainList = (v, what) => {
  if (v == null) return []
  if (!Array.isArray(v) || v.length > 20) throw new Error(`${what} must be a list of at most 20 domains`)
  return [...new Set(v.map(normalizeDomain))]
}

// A start page the browser may open: https, a plain host (no credentials in the URL).
function startUrl(raw) {
  let u
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    throw new Error('url must be a full https address, like https://www.example.com/')
  }
  if (u.protocol !== 'https:') throw new Error('only https sites are allowed')
  if (u.username || u.password) throw new Error('the address must not contain a user name or password')
  u.hash = ''
  return u
}

// Fields of a new site from a request body: label, url, optional domains (default: the host without "www."),
// login_domains (other domains the sign-in goes through, like kakao.com), note, quick_link.
export function siteFromInput(body = {}) {
  const label = String(body.label ?? '').trim().slice(0, 40)
  if (!label) throw new Error('label is required')
  const u = startUrl(body.url)
  const host = u.hostname.toLowerCase()
  const domains = body.domains != null ? domainList(body.domains, 'domains') : [normalizeDomain(host.replace(/^www\./, ''))]
  if (!domains.length) throw new Error('at least one domain is required')
  if (!domains.some(d => host === d || host.endsWith(`.${d}`))) throw new Error('the address is not on any of its domains')
  return {
    label,
    url: u.href,
    domains,
    login_domains: domainList(body.login_domains, 'login_domains'),
    note: String(body.note ?? '').trim().slice(0, 300),
    quick_link: body.quick_link !== false,
  }
}

// Changes of an existing site: only the fields that are present are checked and returned.
export function siteChanges(body = {}, current) {
  const out = {}
  if (body.label !== undefined) { out.label = String(body.label).trim().slice(0, 40); if (!out.label) throw new Error('label must not be empty') }
  if (body.url !== undefined) out.url = startUrl(body.url).href
  if (body.domains !== undefined) { out.domains = domainList(body.domains, 'domains'); if (!out.domains.length) throw new Error('at least one domain is required') }
  if (body.login_domains !== undefined) out.login_domains = domainList(body.login_domains, 'login_domains')
  if (body.note !== undefined) out.note = String(body.note).trim().slice(0, 300)
  if (body.quick_link !== undefined) out.quick_link = !!body.quick_link
  if (body.enabled !== undefined) out.enabled = !!body.enabled
  if (body.login_status !== undefined) {
    if (!LOGIN_STATUSES.includes(body.login_status)) throw new Error('login_status must be unknown, signed_in or needs_login')
    out.login_status = body.login_status
  }
  const url = new URL(out.url ?? current.url)
  const domains = out.domains ?? current.domains
  if ((out.url !== undefined || out.domains !== undefined) && !domains.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`))) throw new Error('the address is not on any of its domains')
  return out
}

export const LOGIN_STATUSES = ['unknown', 'signed_in', 'needs_login']
export const AGENT_LOGIN_STATUSES = ['signed_in', 'needs_login']

// Every domain the browser may open: the enabled sites' own domains and their sign-in domains.
export function allowedDomains(rows) {
  return [...new Set(rows.filter(r => r.enabled).flatMap(r => [...r.domains, ...r.login_domains]))].sort()
}

// The worker accepts at most this many allowed domains (the union of the enabled sites).
export const MAX_ALLOWED_DOMAINS = 200

// The listed site a new one would repeat: the same label, or one of its own domains already a site's own domain.
export function duplicateOf(rows, site) {
  const label = site.label.toLowerCase()
  return rows.find(r => r.label.toLowerCase() === label || r.domains.some(d => site.domains.includes(d))) ?? null
}

// True when the list with this site added (or changed) would exceed what the worker takes.
export function tooManyDomains(rows, site) {
  const others = rows.filter(r => r.id !== site.id)
  return allowedDomains([...others, { enabled: true, ...site }]).length > MAX_ALLOWED_DOMAINS
}

// What a fresh install knows: the sites the browser could use before the list was editable (정부24 was dropped on the owner's request, 2026-11-18).
export const SEED_SITES = [
  { label: 'Coupang', url: 'https://www.coupang.com/', domains: ['coupang.com'], quick_link: true },
  { label: 'Catch Table', url: 'https://www.catchtable.co.kr/', domains: ['catchtable.co.kr', 'catchtable.net'], quick_link: true },
  { label: 'Naver', url: 'https://www.naver.com/', domains: ['naver.com'], quick_link: true },
  { label: 'Kakao', url: 'https://www.kakao.com/', domains: ['kakao.com'], quick_link: false, note: 'Sign-in provider of other sites' },
]
