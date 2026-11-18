// MSW handlers for the staging build: task-api (/api/*) and auth's token endpoint, from db.ts.
// Anything under /api without a handler returns 501 "not mocked" so a gap is visible in the UI.
// Not mocked yet: the finance import details (a passkey step-up tab). The assistant's chats are kept in memory (convs below) and its answers are scripted (see assistantChat).
import { delay, http, HttpResponse, type HttpHandler } from 'msw'
import type { AssistantTurn, DailyData, GoalCategory, GoalItem, MailThread, Slot, TemplateWithState } from '../types'
import * as db from './db'

// Read once at load: the app rewrites the URL to its #/ route after the first render, which drops the query.
const initialQuery = new URLSearchParams(location.search)
const q = () => initialQuery
const empty = () => q().get('scenario') === 'empty'
// ?scenario=inboxzero: everything else as usual, but no unread mail (the Overview shows News in the Inbox slot)
const inboxZero = () => q().get('scenario') === 'inboxzero'
const latency = () => Number(q().get('latency')) || 120

const ok = async <T>(body: T, status = 200) => {
  await delay(latency())
  return HttpResponse.json(body as never, { status })
}
const none = async () => {
  await delay(latency())
  return new HttpResponse(null, { status: 204 })
}
const list = <T>(xs: T[]): T[] => (empty() ? [] : xs)
// The step-up token is told apart from the plain one so the notes handlers can hide what the passkey hides.
const STEP_UP_TOKEN = 'mock-stepup-token'
const unlocked = (request: Request) => request.headers.get('Authorization') === `Bearer ${STEP_UP_TOKEN}`
const uid = () => Math.random().toString(36).slice(2, 10)

// ── Assistant: a scripted chat (SSE) ──
// "Assistant" profile: a question with table / book / Coupang opens the browser and waits for an approval;
// anything else adds a calendar event. "Personal": a short read-only answer.
let pendingApproval: { id: string; kind?: 'action' | 'login'; summary: string; url: string | null; site?: { id: string; label: string } | null; created_at: string } | null = null

// The sites of the browser (a fresh install's list). The scripted chat records a sign-in on them like the real assistant does.
const mockSite = (label: string, url: string, domains: string[], quick_link = true, login_status: 'unknown' | 'signed_in' | 'needs_login' = 'unknown') => ({ id: `s-${uid()}`, label, url, domains, login_domains: [] as string[], quick_link, enabled: true, note: '', login_status, login_checked_at: login_status === 'signed_in' ? new Date().toISOString() : null as string | null, login_note: '', created_by: 'seed' })
let sites = [
  mockSite('Coupang', 'https://www.coupang.com/', ['coupang.com']),
  mockSite('Catch Table', 'https://www.catchtable.co.kr/', ['catchtable.co.kr', 'catchtable.net'], true, 'needs_login'),
  mockSite('정부24', 'https://www.gov.kr/portal/main', ['gov.kr'], true, 'signed_in'),
  mockSite('Naver', 'https://www.naver.com/', ['naver.com']),
  mockSite('Kakao', 'https://www.kakao.com/', ['kakao.com'], false),
]
let approvalDecision: 'approve' | 'deny' | null = null
let browserUrl = 'https://www.catchtable.co.kr/'

// The mock page the assistant's browser "shows" (a screenshot, or a frame of the live view).
const mockPageSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#f4f4f4"/><rect x="0" y="0" width="1280" height="72" fill="#111"/><text x="32" y="46" font-family="sans-serif" font-size="28" fill="#fff">Mock browser page</text><text x="64" y="160" font-family="sans-serif" font-size="32" fill="#111">${browserUrl}</text><rect x="64" y="220" width="420" height="64" rx="6" fill="#fff" stroke="#111"/><text x="88" y="262" font-family="sans-serif" font-size="24" fill="#111">Reserve a table for 2</text></svg>`

// Stored chats of the one Assistant list: each has one of the two agents ("assistant" acts, "personal" reads private data).
interface MockConv { id: string; profile: 'assistant' | 'personal'; title: string; folder: string | null; created_at: string; updated_at: string; turns: AssistantTurn[] }
const mockTurn = (id: string, question: string, text: string): AssistantTurn => ({ id, question, parts: [{ kind: 'text', text }], state: 'done', done: { ok: true, duration_ms: 4000 } })
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const convs: MockConv[] = [
  { id: '00000000-0000-4000-8000-000000000001', profile: 'personal', title: 'How much did I spend in October?', folder: 'money', created_at: hoursAgo(30), updated_at: hoursAgo(30), turns: [mockTurn('s1', 'How much did I spend in October?', 'In October you spent about ₩1,240,000 (mock numbers), mostly food and transport.')] },
  { id: '00000000-0000-4000-8000-000000000002', profile: 'assistant', title: 'Any unread mail that needs a reply?', folder: 'mail', created_at: hoursAgo(5), updated_at: hoursAgo(5), turns: [mockTurn('s2', 'Any unread mail that needs a reply?', 'Two unread mails need a reply: the dentist (confirm Friday) and the landlord (lease question).')] },
  { id: '00000000-0000-4000-8000-000000000003', profile: 'personal', title: 'Summarize my week', folder: 'summaries', created_at: hoursAgo(70), updated_at: hoursAgo(70), turns: [mockTurn('s3', 'Summarize my week', 'Four workouts, 7h 10m of sleep on average, and 12 of 15 tasks done (mock numbers).')] },
]
// The operator routes a new chat by its first question (keyword rule); unclear goes to personal.
const mockRoute = (q: string): 'assistant' | 'personal' =>
  /mail|inbox|reply|event|todo|remind|book|reserve|order|table|coupang|쿠팡|메일|일정|예약|주문|로그인|sign in|site|사이트/i.test(q) && !/spend|spent|sleep|health|stock|market|note|지출|건강|자산/i.test(q) ? 'assistant' : 'personal'

function assistantChat({ request }: { request: Request }) {
  return request.json().then((b) => {
    const { question = '', profile: hint, conversation_id } = b as { question?: string; profile?: string; conversation_id?: string }
    let conv = conversation_id ? convs.find((c) => c.id === conversation_id) : undefined
    const profile = conv?.profile ?? (hint === 'assistant' || hint === 'personal' ? hint : mockRoute(question))
    const convId = conv?.id ?? `00000000-0000-4000-8000-${uid().padEnd(12, '0').slice(0, 12)}`
    if (!conv) {
      conv = { id: convId, profile, title: question.slice(0, 80), folder: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), turns: [] }
      convs.unshift(conv)
    }
    const saved: AssistantTurn = { id: `t-${uid()}`, question, parts: [], state: 'streaming' }
    conv.turns.push(saved)
    const enc = new TextEncoder()
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const stream = new ReadableStream({
      async start(c) {
        const send = (o: object) => {
          c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
          const e = o as { type: string; text?: string; id?: string; name?: string; input?: unknown; error?: boolean; output?: string }
          if (e.type === 'text') {
            const last = saved.parts[saved.parts.length - 1]
            if (last?.kind === 'text') last.text += e.text ?? ''
            else saved.parts.push({ kind: 'text', text: e.text ?? '' })
          } else if (e.type === 'tool') saved.parts.push({ kind: 'tool', id: e.id!, name: e.name!, input: e.input })
          else if (e.type === 'tool_result') { const p = saved.parts.find((x) => x.kind === 'tool' && x.id === e.id); if (p && p.kind === 'tool') p.result = { error: !!e.error, output: e.output ?? '' } }
        }
        send({ type: 'conversation', id: convId, turn_id: saved.id })
        await sleep(300)
        if (profile === 'assistant' && /sign in|log ?in|로그인/i.test(question)) {
          const site = sites.find(s => s.label === 'Catch Table')!
          send({ type: 'text', text: 'Catch Table shows a sign-in page. I will ask you to sign in.' })
          send({ type: 'tool', id: 'l1', name: 'browser_request_login', input: { site: site.label, message: 'approve the sign-in on your phone if it asks' } })
          pendingApproval = { id: `a-${uid()}`, kind: 'login', summary: `Sign in to ${site.label} in the Browser panel: approve the sign-in on your phone if it asks. Nothing to press: the assistant watches the page and carries on once it shows your account.`, url: site.url, site: { id: site.id, label: site.label }, created_at: new Date().toISOString() }
          approvalDecision = null
          // the watch "sees the account" after a few seconds unless the owner cancels
          for (let i = 0; i < 300 && !approvalDecision; i++) { await sleep(200); if (i === 17 && !approvalDecision) { approvalDecision = 'approve'; pendingApproval = null } }
          const result = approvalDecision === 'approve' ? 'approved' : approvalDecision === 'deny' ? 'denied' : 'timed out'
          send({ type: 'tool_result', id: 'l1', error: false, output: JSON.stringify({ result }) })
          if (result === 'approved') {
            send({ type: 'tool', id: 'l2', name: 'site_login_status', input: { site: site.label, status: 'signed_in', note: 'shows the account menu' } })
            site.login_status = 'signed_in'; site.login_checked_at = new Date().toISOString(); site.login_note = 'shows the account menu'
            send({ type: 'tool_result', id: 'l2', error: false, output: JSON.stringify({ site: site.label, sign_in: 'signed_in' }) })
            send({ type: 'text', text: 'You are signed in to Catch Table; I recorded it.' })
          } else send({ type: 'text', text: 'Okay, I did not continue with Catch Table.' })
        } else if (profile === 'assistant' && /add .*site|new site|사이트 추가|opentable|yanolja/i.test(question)) {
          send({ type: 'text', text: 'Yanolja is not in the browser\'s list. I propose adding it:' })
          send({ type: 'tool', id: 'p1', name: 'propose_site', input: { label: 'Yanolja', url: 'https://www.yanolja.com/', note: 'Hotel booking' } })
          await sleep(300)
          send({ type: 'tool_result', id: 'p1', error: false, output: JSON.stringify({ status: 'proposed', label: 'Yanolja', url: 'https://www.yanolja.com/' }) })
          send({ type: 'text', text: 'Press Add on the card and I can use it.' })
        } else if (profile === 'assistant' && /table|book|coupang|쿠팡|예약/i.test(question)) {
          send({ type: 'text', text: 'Opening Catch Table to look for a table for two on Friday at 19:00.' })
          send({ type: 'tool', id: 'b1', name: 'browser_open', input: { url: browserUrl } })
          await sleep(400)
          send({ type: 'tool_result', id: 'b1', error: false, output: JSON.stringify({ url: browserUrl, title: 'Catch Table (mock)' }) })
          pendingApproval = { id: `a-${uid()}`, summary: 'Reserve 2 people at Restaurant X (Gangnam) on Friday 19:00. No deposit. Tap Approve to confirm the reservation.', url: browserUrl, created_at: new Date().toISOString() }
          approvalDecision = null
          send({ type: 'tool', id: 'a1', name: 'request_approval', input: { summary: pendingApproval.summary } })
          for (let i = 0; i < 300 && !approvalDecision; i++) await sleep(200)
          const result = approvalDecision === 'approve' ? 'approved' : approvalDecision === 'deny' ? 'denied' : 'timed out'
          send({ type: 'tool_result', id: 'a1', error: false, output: JSON.stringify({ result }) })
          send({ type: 'text', text: result === 'approved' ? 'Reserved: 2 people, Restaurant X, Friday 19:00.' : 'Okay, I did not book anything.' })
        } else if (profile === 'assistant') {
          const date = new Date(); const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const ev = { id: `e-${uid()}`, title: 'Dentist', start_date: iso, end_date: iso, time: '15:00', recurrence: null, created_at: Date.now() }
          send({ type: 'tool', id: 'w1', name: 'event_add', input: { title: ev.title, start_date: iso, time: '15:00' } })
          await sleep(300)
          db.events.push(ev as (typeof db.events)[number])
          send({ type: 'tool_result', id: 'w1', error: false, output: JSON.stringify({ created: 'event', id: ev.id, title: ev.title, start_date: iso, end_date: iso, time: '15:00' }) })
          send({ type: 'text', text: `Added **Dentist** today (${iso}) at 15:00.` })
        } else {
          send({ type: 'text', text: 'This month you spent about ₩1,240,000 (mock numbers). Hand this chat to Assistant if you want me to change something.' })
        }
        send({ type: 'done', ok: true, duration_ms: 1500 })
        saved.state = 'done'; saved.done = { ok: true, duration_ms: 1500 }
        conv!.updated_at = new Date().toISOString()
        conv!.folder = conv!.folder ?? (profile === 'assistant' ? (/mail|메일/i.test(question) ? 'mail' : 'tasks') : 'money')
        c.close()
      },
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  })
}

const slotOf = (date: string): Slot => (['weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'weekend'] as Slot[])[new Date(`${date}T12:00:00`).getDay()]

function daily(slotDate: string): DailyData {
  const slot = slotOf(slotDate)
  const templates: TemplateWithState[] = (empty() ? [] : db.templates[slot]).map((t) => ({ ...t, completed: db.completions.has(`${t.id}|${slotDate}`), skipped: db.skips.has(`${t.id}|${slotDate}`) }))
  return {
    slotDate, slot, templates,
    completionIds: templates.filter((t) => t.completed).map((t) => t.id),
    additions: list(db.additions.filter((a) => a.slot_date === slotDate)),
    eventCompletions: [...db.eventCompletions].filter((k) => k.endsWith(`|${slotDate}`)).map((k) => k.split('|')[0]),
    skipIds: templates.filter((t) => t.skipped).map((t) => t.id),
  }
}

const threads = (): MailThread[] =>
  db.mailItems.map((m) => ({ id: m.id, account_id: m.account_id, thread_id: m.thread_id ?? m.id, subject: m.subject, from_address: m.from_address, from_name: m.from_name, received_at: m.received_at, snippet: m.snippet, count: 1, unread_count: m.read ? 0 : 1, flagged: m.flagged, category: m.category ?? 'general', participants: [m.from_name ?? m.from_address] }))

export const handlers: HttpHandler[] = [
  // ?scenario=stepup: the first step-up token request answers with a login_url that comes straight back
  // (a full page load, like auth's passkey page), the next one passes. Tests the return-to-screen flow.
  http.get('https://auth.kevinprk.com/api/token', async ({ request }) => {
    const u = new URL(request.url)
    if (u.searchParams.get('step_up') && q().get('scenario') === 'stepup' && sessionStorage.getItem('kp-mock-stepup') !== 'done') {
      sessionStorage.setItem('kp-mock-stepup', 'done')
      const back = new URL(u.searchParams.get('return') ?? location.href)
      back.searchParams.set('stepup', 'back') // a different URL, so the browser really reloads
      return ok({ login_url: back.toString() }, 401)
    }
    return ok({ access_token: u.searchParams.get('step_up') ? STEP_UP_TOKEN : 'mock-token', expires_in: 900, user: { username: 'kevinprk' } })
  }),
  http.post('https://auth.kevinprk.com/api/step-up/lock', none),
  http.get('/api/auth/me', async () => ok({ username: 'kevinprk' })),

  http.get('/api/templates', async () => ok(empty() ? { mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [] } : db.templates)),
  http.post('/api/templates', async ({ request }) => {
    const b = (await request.json()) as { slot: Slot; text: string }
    const t = { id: `t-${uid()}`, slot: b.slot, text: b.text, position: db.templates[b.slot].length, group_id: null, created_at: Date.now() }
    db.templates[b.slot].push(t)
    return ok(t, 201)
  }),
  http.put('/api/templates/reorder', none),
  http.put('/api/templates/:id', async ({ params, request }) => {
    const t = Object.values(db.templates).flat().find((x) => x.id === params.id)
    if (t) t.text = ((await request.json()) as { text: string }).text
    return ok(t)
  }),
  http.delete('/api/templates/:id', async ({ params }) => {
    for (const s of Object.keys(db.templates) as Slot[]) db.templates[s] = db.templates[s].filter((t) => t.id !== params.id)
    return none()
  }),

  http.get('/api/daily/additions/range', async () => ok(list(db.additions))),
  http.post('/api/daily/additions', async ({ request }) => {
    const b = (await request.json()) as { slotDate: string; text: string }
    const a = { id: `a-${uid()}`, slot_date: b.slotDate, text: b.text, completed: false, created_at: Date.now() }
    db.additions.push(a)
    return ok(a, 201)
  }),
  http.put('/api/daily/additions/:id', async ({ params, request }) => {
    const a = db.additions.find((x) => x.id === params.id)
    if (a) a.text = ((await request.json()) as { text: string }).text
    return ok(a)
  }),
  http.delete('/api/daily/additions/:id', async ({ params }) => {
    db.additions.splice(0, db.additions.length, ...db.additions.filter((a) => a.id !== params.id))
    return none()
  }),
  http.post('/api/daily/toggle', async ({ request }) => {
    const b = (await request.json()) as { type: 'template' | 'addition'; id: string; slotDate?: string; completed: boolean }
    if (b.type === 'addition') {
      const a = db.additions.find((x) => x.id === b.id)
      if (a) a.completed = b.completed
      return ok({ ok: true, groupCompleted: [] })
    }
    const key = `${b.id}|${b.slotDate}`
    if (b.completed) db.completions.add(key)
    else db.completions.delete(key)
    return ok({ ok: true, groupCompleted: [] })
  }),
  http.post('/api/daily/skip', async ({ request }) => {
    const b = (await request.json()) as { id: string; slotDate: string; skipped: boolean }
    const key = `${b.id}|${b.slotDate}`
    if (b.skipped) db.skips.add(key)
    else db.skips.delete(key)
    return ok({ ok: true })
  }),
  http.get('/api/daily/:date', async ({ params }) => ok(daily(String(params.date)))),

  http.get('/api/events', async () => ok(list(db.events))),
  http.post('/api/events', async ({ request }) => {
    const e = { id: `e-${uid()}`, time: null, recurrence: null, created_at: Date.now(), ...((await request.json()) as object) } as (typeof db.events)[number]
    db.events.push(e)
    return ok(e, 201)
  }),
  http.post('/api/events/:id/toggle', async ({ params, request }) => {
    const b = (await request.json()) as { slot_date: string; completed: boolean }
    const key = `${params.id}|${b.slot_date}`
    if (b.completed) db.eventCompletions.add(key)
    else db.eventCompletions.delete(key)
    return none()
  }),
  http.put('/api/events/:id', async ({ params, request }) => {
    const e = db.events.find((x) => x.id === params.id)
    if (e) Object.assign(e, await request.json())
    return ok(e)
  }),
  http.delete('/api/events/:id', async ({ params }) => {
    db.events.splice(0, db.events.length, ...db.events.filter((e) => e.id !== params.id))
    return none()
  }),

  http.get('/api/settings', async () => ok(db.settings)),
  http.put('/api/settings', async ({ request }) => {
    Object.assign(db.settings, await request.json())
    return ok(db.settings)
  }),

  http.get('/api/todos', async () => ok(list(db.todos))),
  http.post('/api/todos', async ({ request }) => {
    const b = (await request.json()) as { text: string; due_date?: string }
    const t = { id: `td-${uid()}`, text: b.text, completed: false, due_date: b.due_date ?? null, created_at: new Date().toISOString() }
    db.todos.unshift(t)
    return ok(t, 201)
  }),
  http.patch('/api/todos/:id', async ({ params, request }) => {
    const t = db.todos.find((x) => x.id === params.id)
    if (t) Object.assign(t, await request.json())
    return ok(t)
  }),
  http.delete('/api/todos/:id', async ({ params }) => {
    db.todos.splice(0, db.todos.length, ...db.todos.filter((t) => t.id !== params.id))
    return none()
  }),

  http.get('/api/goals', async () => ok(list(db.goals))),
  http.post('/api/goals/periods/general', async () => ok(db.goals[1])),
  http.post('/api/goals/periods', async ({ request }) => {
    const b = (await request.json()) as { year: number; half: 1 | 2 | null; kind?: 'retro' }
    const p = { id: `gp-${uid()}`, kind: b.kind ?? (b.half ? 'half' : 'year'), year: b.year, half: b.half ?? null, categories: [] } as (typeof db.goals)[number]
    db.goals.push(p)
    return ok(p, 201)
  }),
  http.delete('/api/goals/periods/:id', async ({ params }) => {
    db.goals.splice(0, db.goals.length, ...db.goals.filter((p) => p.id !== params.id))
    return none()
  }),
  http.post('/api/goals/categories', async ({ request }) => {
    const b = (await request.json()) as { period_id: string; name: string }
    const c: GoalCategory = { id: `gc-${uid()}`, period_id: b.period_id, name: b.name, position: 99, items: [] }
    db.goals.find((p) => p.id === b.period_id)?.categories.push(c)
    return ok(c, 201)
  }),
  http.put('/api/goals/categories/:id', async ({ params, request }) => {
    const c = db.goals.flatMap((p) => p.categories).find((x) => x.id === params.id)
    if (c) c.name = ((await request.json()) as { name: string }).name
    return ok(c)
  }),
  http.delete('/api/goals/categories/:id', async ({ params }) => {
    for (const p of db.goals) p.categories = p.categories.filter((c) => c.id !== params.id)
    return none()
  }),
  http.post('/api/goals/items', async ({ request }) => {
    const b = (await request.json()) as { category_id: string; text: string }
    const it: GoalItem = { id: `gi-${uid()}`, category_id: b.category_id, text: b.text, completed: false, crossed_out: false, note: null, position: 99 }
    db.goals.flatMap((p) => p.categories).find((c) => c.id === b.category_id)?.items.push(it)
    return ok(it, 201)
  }),
  http.put('/api/goals/items/:id', async ({ params, request }) => {
    const it = db.goals.flatMap((p) => p.categories).flatMap((c) => c.items).find((x) => x.id === params.id)
    if (it) Object.assign(it, await request.json())
    return ok(it)
  }),
  http.delete('/api/goals/items/:id', async ({ params }) => {
    for (const c of db.goals.flatMap((p) => p.categories)) c.items = c.items.filter((i) => i.id !== params.id)
    return none()
  }),

  http.get('/api/news/flagged', async () => ok(list(db.news.filter((n) => n.flagged)))),
  http.get('/api/news', async () => ok(list(db.news))),
  http.post('/api/news/flag', async ({ request }) => {
    const b = (await request.json()) as { link: string }
    const n = db.news.find((x) => x.link === b.link)
    if (n) n.flagged = true
    return ok({ flagged: true })
  }),
  http.post('/api/news/unflag', async ({ request }) => {
    const b = (await request.json()) as { link: string }
    const n = db.news.find((x) => x.link === b.link)
    if (n) n.flagged = false
    return ok({ flagged: false })
  }),

  http.get('/api/assistant/conversations', async () =>
    ok({ conversations: [...convs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((c) => ({ id: c.id, profile: c.profile, title: c.title, folder: c.folder, created_at: c.created_at, updated_at: c.updated_at, turns: c.turns.length, streaming: c.turns.some((t) => t.state === 'streaming') })) })),
  http.get('/api/assistant/conversations/:id', async ({ params }) => {
    const c = convs.find((x) => x.id === params.id)
    return c ? ok(c) : HttpResponse.json({ error: 'not found' }, { status: 404 })
  }),
  http.patch('/api/assistant/conversations/:id', async ({ request, params }) => {
    const c = convs.find((x) => x.id === params.id)
    if (!c) return HttpResponse.json({ error: 'conversation not found' }, { status: 400 })
    const b = (await request.json()) as { title?: string; folder?: string; profile?: string }
    if (b.title) c.title = b.title
    if (b.folder) c.folder = b.folder
    if (b.profile === 'assistant' || b.profile === 'personal') c.profile = b.profile
    return new HttpResponse(null, { status: 204 })
  }),
  http.delete('/api/assistant/conversations/:id', async ({ params }) => {
    const i = convs.findIndex((x) => x.id === params.id)
    if (i >= 0) convs.splice(i, 1)
    return new HttpResponse(null, { status: 204 })
  }),
  http.post('/api/assistant/chat', assistantChat),
  http.post('/api/assistant/chat/stop', async () => ok({ stopped: true })),
  http.get('/api/assistant/approval', async () => ok({ approval: pendingApproval })),
  http.post('/api/assistant/approval', async ({ request }) => {
    const b = (await request.json()) as { id: string; decision: 'approve' | 'deny' }
    if (pendingApproval && pendingApproval.id === b.id) { approvalDecision = b.decision; pendingApproval = null }
    return ok({ ok: true })
  }),
  http.get('/api/assistant/browser/sites', async () => ok({ sites })),
  http.post('/api/assistant/browser/sites', async ({ request }) => {
    const b = (await request.json()) as { label?: string; url?: string; login_domains?: string[]; domains?: string[]; created_by?: string }
    if (!b.label?.trim() || !/^https:\/\//.test(b.url ?? '')) return HttpResponse.json({ error: 'url must be a full https address, like https://www.example.com/' }, { status: 400 })
    const host = new URL(b.url!).hostname.replace(/^www\./, '')
    const s = { ...mockSite(b.label.trim(), b.url!, b.domains ?? [host]), login_domains: b.login_domains ?? [], created_by: b.created_by ?? 'owner' }
    sites = [...sites, s]
    return HttpResponse.json({ site: s, synced: true }, { status: 201 })
  }),
  http.patch('/api/assistant/browser/sites/:id', async ({ request, params }) => {
    const b = (await request.json()) as Partial<(typeof sites)[number]>
    sites = sites.map(s => (s.id === params.id ? { ...s, ...b } : s))
    return ok({ site: sites.find(s => s.id === params.id), synced: false })
  }),
  http.post('/api/assistant/browser/sites/:id/signin-watch', async ({ request, params }) => {
    const b = (await request.json().catch(() => ({}))) as { stop?: boolean }
    // the watch sees the account a few seconds after the owner signs in (here: after 4 s)
    if (!b.stop) setTimeout(() => { sites = sites.map(s => (s.id === params.id ? { ...s, login_status: 'signed_in' as const, login_checked_at: new Date().toISOString(), login_note: 'seen after you signed in' } : s)) }, 4000)
    return ok({ ok: true })
  }),
  http.delete('/api/assistant/browser/sites/:id', async ({ params }) => {
    sites = sites.filter(s => s.id !== params.id)
    return ok({ ok: true, synced: true })
  }),
  http.get('/api/assistant/browser/state', async () => ok({ url: browserUrl, title: 'Catch Table (mock)', tabs: 1, gate_open_seconds: 0 })),
  http.get('/api/assistant/browser/screenshot', async () => new HttpResponse(mockPageSvg(), { headers: { 'Content-Type': 'image/svg+xml' } })),
  // The live view: the same page pushed as events, like the worker's screencast (an SVG stands in for the JPEG).
  http.get('/api/assistant/browser/stream', async () => {
    const enc = new TextEncoder()
    let timer: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream({
      start(c) {
        const send = (event: string, data: object) => c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        const push = () => {
          try {
            send('state', { url: browserUrl, title: 'Catch Table (mock)' })
            send('frame', { mime: 'image/svg+xml', data: btoa(unescape(encodeURIComponent(mockPageSvg()))), w: 1280, h: 800 })
          } catch { clearInterval(timer) }
        }
        push()
        timer = setInterval(push, 1000)
      },
      cancel() { clearInterval(timer) },
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }),
  http.post('/api/assistant/browser/input', async ({ request }) => {
    const b = (await request.json()) as { type: string; url?: string }
    if (b.type === 'open' && b.url) browserUrl = b.url
    return ok({ url: browserUrl, title: 'Catch Table (mock)' })
  }),
  http.get('/api/mail/accounts', async () => ok(list(db.mailAccounts))),
  http.get('/api/mail/threads/items', async () => ok(list(db.mailItems))),
  http.get('/api/mail/threads', async ({ request }) => {
    const url = new URL(request.url)
    const category = url.searchParams.get('category')
    const flagged = url.searchParams.get('flagged') === 'true'
    const unread = url.searchParams.get('unread') === 'true'
    const limit = Number(url.searchParams.get('limit')) || undefined
    return ok(list(threads().filter((t) => (!category || t.category === category) && (!flagged || t.flagged) && (!unread || (t.unread_count > 0 && !inboxZero())))).slice(0, limit))
  }),
  http.post('/api/mail/threads/move', async ({ request }) => {
    const { thread_id, category } = (await request.json()) as { thread_id: string; category: 'general' | 'others' }
    db.mailItems.forEach((m) => { if ((m.thread_id ?? m.id) === thread_id) m.category = category })
    return ok({ category })
  }),
  http.get('/api/mail/sender-rules', async () => ok(list(db.mailSenderRules))),
  http.put('/api/mail/sender-rules', async ({ request }) => {
    const { from_address, category } = (await request.json()) as { from_address: string; category: 'general' | 'others' }
    const addr = from_address.toLowerCase()
    db.mailSenderRules.splice(0, db.mailSenderRules.length, { from_address: addr, category, created_at: new Date().toISOString() }, ...db.mailSenderRules.filter((r) => r.from_address !== addr))
    let moved = 0
    db.mailItems.forEach((m) => { if (m.from_address.toLowerCase() === addr && (m.category ?? 'general') !== category) { m.category = category; moved++ } })
    return ok({ from_address: addr, category, moved })
  }),
  http.delete('/api/mail/sender-rules', async ({ request }) => {
    const addr = (new URL(request.url).searchParams.get('from_address') ?? '').toLowerCase()
    db.mailSenderRules.splice(0, db.mailSenderRules.length, ...db.mailSenderRules.filter((r) => r.from_address !== addr))
    return ok({ ok: true })
  }),
  http.get('/api/mail/unread-counts', async () => {
    const unread = (c: string) => (empty() || inboxZero() ? [] : db.mailItems).filter((m) => !m.read && (m.category ?? 'general') === c).length
    return ok({ general: unread('general'), others: unread('others') })
  }),
  http.get('/api/mail/items/:id', async ({ params }) => ok(db.mailItems.find((m) => m.id === params.id))),
  http.get('/api/mail/items', async () => ok(list(db.mailItems))),
  http.post('/api/mail/threads/read', async () => ok({ ok: true })),
  http.post('/api/mail/items/:id/read', async () => ok({ ok: true })),
  http.get('/api/mail/sync', async () => ok({ running: false, finished_at: new Date().toISOString(), synced: 0, error: null })),
  http.post('/api/mail/sync', async () => ok({ running: false, finished_at: new Date().toISOString(), synced: 0, error: null })),

  // The private data behind the passkey step-up: the same mocked token opens all of it.
  http.get('/api/assets/summary', async () => ok(db.assetSummary)),
  http.get('/api/assets/status', async () => ok(db.assetStatus)),
  http.post('/api/assets/sync', async () => ok({ rowsTotal: 2275, rowsNew: 0, rowsUpdated: 0, sourceFile: 'banksalad-export.zip' })),
  http.get('/api/assets/password', async () => ok({ isSet: true })),
  http.post('/api/assets/password', async () => ok({ ok: true })),
  http.get('/api/assets/notify-settings', async () => ok({ financeNotifyEnabled: 'true', financeNotifyDay: '22', financeNotifyHour: '9', financeNotifyMinute: '0' })),
  http.post('/api/assets/notify-settings', async () => ok({ ok: true })),
  http.get('/api/health-data/summary', async () => ok(empty() ? null : db.healthSummary)),
  http.get('/api/health-data/reports', async () => ok(empty() ? [] : db.healthReports)),
  http.get('/api/trader/summary', async () => ok(empty() ? { ...db.traderSummary, etfs: [], portfolio: { ...db.traderSummary.portfolio, history: [] }, buys: { ...db.traderSummary.buys, n: 0, rows: [] }, daytrade: { days: [] } } : db.traderSummary)),

  // Notes: like task-api, a plain session sees the notes that are not hidden, the step-up token all of them.
  // ?scenario=noteconflict answers every save with 409; ?scenario=notefail with 500.
  http.get('/api/notes', async ({ request }) => {
    const term = new URL(request.url).searchParams.get('q')?.trim().toLowerCase() ?? ''
    const rows = db.notes
      .filter((n) => (unlocked(request) || !n.hidden) && (!term || `${n.title} ${n.body}`.toLowerCase().includes(term)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((n) => ({ key: n.key, title: n.title, hidden: n.hidden, created_at: n.created_at, updated_at: n.updated_at, chars: n.body.length, snippet: n.body.replace(/\s+/g, ' ').slice(0, 140) }))
    return ok(list(rows))
  }),
  http.get('/api/notes/:key', async ({ params, request }) => {
    const n = db.notes.find((x) => x.key === params.key && (unlocked(request) || !x.hidden))
    return n ? ok(n) : ok({ error: 'not found' }, 404)
  }),
  http.post('/api/notes', async ({ request }) => {
    const b = (await request.json()) as { title: string; body: string; hidden?: boolean }
    if (b.hidden && !unlocked(request)) return ok({ error: 'Passkey needed to hide a note' }, 401)
    const now = new Date().toISOString()
    const n = { key: `n-${uid().slice(0, 8)}`, title: b.title, body: b.body, hidden: b.hidden === true, created_at: now, updated_at: now }
    db.notes.push(n)
    return ok({ key: n.key, title: n.title, hidden: n.hidden, updated_at: n.updated_at }, 201)
  }),
  http.put('/api/notes/:key', async ({ params, request }) => {
    if (q().get('scenario') === 'noteconflict') return ok({ error: 'The note changed since this version was made' }, 409)
    if (q().get('scenario') === 'notefail') return ok({ error: 'Internal error' }, 500)
    const b = (await request.json()) as { title?: string; body: string; hidden?: boolean; base_updated_at?: string | null }
    if (b.hidden !== undefined && !unlocked(request)) return ok({ error: 'Passkey needed to hide or show a note' }, 401)
    const n = db.notes.find((x) => x.key === params.key && (unlocked(request) || !x.hidden))
    if (!n) return ok({ error: 'not found' }, 404)
    if (b.base_updated_at && Date.parse(b.base_updated_at) !== Date.parse(n.updated_at)) return ok({ error: 'The note changed since this version was made' }, 409)
    n.body = b.body
    if (b.title !== undefined) n.title = b.title
    if (b.hidden !== undefined) n.hidden = b.hidden
    n.updated_at = new Date().toISOString()
    return ok({ key: n.key, title: n.title, hidden: n.hidden, updated_at: n.updated_at })
  }),
  http.delete('/api/notes/:key', async ({ params, request }) => {
    const i = db.notes.findIndex((x) => x.key === params.key && (unlocked(request) || !x.hidden))
    if (i < 0) return ok({ error: 'not found' }, 404)
    db.notes.splice(i, 1)
    return none()
  }),

  http.get('/api/push/vapid-key', async () => ok({ key: '' })),
  http.get('/api/push/subscriptions', async () => ok({ subscriptions: [] })),

  http.all('/api/*', async ({ request }) => ok({ error: `not mocked: ${request.method} ${new URL(request.url).pathname}` }, 501)),
  http.all('https://auth.kevinprk.com/*', async ({ request }) => ok({ error: `not mocked: ${request.method} ${new URL(request.url).pathname}` }, 501)),
]
