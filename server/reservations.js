// Scheduled reservations (docs/apps/browser-agent.md, "Scheduled reservations"). The owner approves one job with the passkey:
// a shop, a day, an opening time, a party size and the slots in the order to try them (the owner's priority; the latest first unless they ask for another), for a reservation that
// costs nothing. At the opening time the operator runs it. This file is the part that does not touch the network: what a job
// may be, when it is due, and how its state may change.

export const AUTO_HOSTS = ['catchtable.co.kr', 'catchtable.net'] // the only sites where a job may confirm by itself
export const ACTIVE = ['scheduled', 'preparing', 'running']
export const FINISHED = ['succeeded', 'failed', 'cancelled', 'expired', 'dry_run_done']
export const STATES = [...ACTIVE, ...FINISHED]
export const WINDOW_MIN = 20 // a job still waiting this long after its opening time is expired

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KST_MS = 9 * 3600_000

export const kstDate = (now = new Date()) => new Date(now.getTime() + KST_MS).toISOString().slice(0, 10)
const fireAt = (date, time) => new Date(`${date}T${time}:00+09:00`)

const hostOn = (host, domains) => domains.some((d) => host === d || host.endsWith(`.${d}`))

// A job from the card the owner approved. `domains` are the allowed domains of the enabled sites. Throws a message for the owner.
export function jobFromInput(body = {}, domains = [], now = new Date()) {
  const shop_name = String(body.shop_name ?? '').trim()
  if (!shop_name || shop_name.length > 80) throw new Error('shop_name: 1 to 80 characters')
  let url
  try { url = new URL(String(body.shop_url ?? '')) } catch { throw new Error('shop_url is not an address') }
  if (url.protocol !== 'https:') throw new Error('shop_url must be https')
  const host = url.hostname.toLowerCase()
  if (!hostOn(host, domains)) throw new Error('that site is not in the browser\'s site list')
  if (!hostOn(host, AUTO_HOSTS)) throw new Error('scheduled reservations work on Catch Table only for now')
  const party = Number(body.party)
  if (!Number.isInteger(party) || party < 1 || party > 6) throw new Error('party: 1 to 6')
  const slots = [...new Set(Array.isArray(body.slots) ? body.slots.map(String) : [])]
  if (!slots.length || slots.length > 8 || !slots.every((t) => TIME_RE.test(t))) throw new Error('slots: 1 to 8 times, HH:MM')
  // the order given is the priority: the first slot that is open is taken
  const open_time = String(body.open_time ?? '')
  if (!TIME_RE.test(open_time)) throw new Error('open_time: HH:MM (KST)')
  const today = kstDate(now)
  let date = body.date == null || body.date === '' ? null : String(body.date)
  if (date == null) date = now.getTime() <= fireAt(today, open_time).getTime() + WINDOW_MIN * 60_000 ? today : kstDate(new Date(now.getTime() + 86_400_000))
  if (!DATE_RE.test(date)) throw new Error('date: YYYY-MM-DD')
  const at = fireAt(date, open_time)
  if (Number.isNaN(at.getTime())) throw new Error('date: not a calendar day')
  if (at.getTime() + WINDOW_MIN * 60_000 < now.getTime()) throw new Error('that opening time has already passed')
  if (at.getTime() - now.getTime() > 3 * 86_400_000) throw new Error('at most 3 days ahead')
  const mode = body.mode === 'dry_run' ? 'dry_run' : 'live'
  return { shop_name, shop_url: url.toString(), party, slots, open_time, date, mode, fire_at: at.toISOString() }
}

const NEXT = {
  scheduled: ['preparing', 'cancelled', 'expired', 'failed'],
  preparing: ['running', 'failed', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'dry_run_done'],
}
export const canMove = (from, to) => (NEXT[from] ?? []).includes(to)

// What the owner is told when a job ends (task-api sends the push).
export function pushFor(job, to) {
  const shop = job.shop_name
  switch (to) {
    case 'succeeded': return { title: `예약 완료: ${shop}`, body: `${job.date} ${job.result?.time ?? ''} ${job.party}명${job.result?.booking_number ? ` · 예약번호 ${job.result.booking_number}` : ''}`.trim() }
    case 'failed': return { title: `예약 실패: ${shop}`, body: String(job.result?.detail ?? 'The reservation was not made.').slice(0, 200) }
    case 'expired': return { title: `예약 시도를 놓쳤습니다: ${shop}`, body: `${job.date} ${job.open_time} 오픈 시각이 지났습니다.` }
    case 'dry_run_done': return { title: `예약 드라이런 완료: ${shop}`, body: String(job.result?.detail ?? '').slice(0, 200) }
    default: return null
  }
}
