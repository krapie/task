// MSW handlers for the staging build: task-api (/api/*) and auth's token endpoint, from db.ts.
// Anything under /api without a handler returns 501 "not mocked" so a gap is visible in the UI.
// Not mocked yet: assets (finance), health, assistant, notes (the passkey step-up tabs).
import { delay, http, HttpResponse, type HttpHandler } from 'msw'
import type { DailyData, GoalCategory, GoalItem, MailThread, Slot, TemplateWithState } from '../types'
import * as db from './db'

const q = () => new URLSearchParams(location.search)
const empty = () => q().get('scenario') === 'empty'
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
const uid = () => Math.random().toString(36).slice(2, 10)

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
  db.mailItems.map((m) => ({ id: m.id, account_id: m.account_id, thread_id: m.thread_id ?? m.id, subject: m.subject, from_address: m.from_address, from_name: m.from_name, received_at: m.received_at, snippet: m.snippet, count: 1, unread_count: m.read ? 0 : 1, flagged: m.flagged, participants: [m.from_name ?? m.from_address] }))

export const handlers: HttpHandler[] = [
  http.get('https://auth.kevinprk.com/api/token', async () => ok({ access_token: 'mock-token', expires_in: 900, user: { username: 'kevinprk' } })),
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
      return none()
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

  http.get('/api/mail/accounts', async () => ok(list(db.mailAccounts))),
  http.get('/api/mail/threads/items', async () => ok(list(db.mailItems))),
  http.get('/api/mail/threads', async () => ok(list(threads()))),
  http.get('/api/mail/items/:id', async ({ params }) => ok(db.mailItems.find((m) => m.id === params.id))),
  http.get('/api/mail/items', async () => ok(list(db.mailItems))),
  http.post('/api/mail/threads/read', none),
  http.post('/api/mail/items/:id/read', none),
  http.get('/api/mail/sync', async () => ok({ running: false, finished_at: new Date().toISOString(), synced: 0, error: null })),
  http.post('/api/mail/sync', async () => ok({ running: false, finished_at: new Date().toISOString(), synced: 0, error: null })),

  http.get('/api/push/vapid-key', async () => ok({ key: '' })),
  http.get('/api/push/subscriptions', async () => ok({ subscriptions: [] })),

  http.all('/api/*', async ({ request }) => ok({ error: `not mocked: ${request.method} ${new URL(request.url).pathname}` }, 501)),
  http.all('https://auth.kevinprk.com/*', async ({ request }) => ok({ error: `not mocked: ${request.method} ${new URL(request.url).pathname}` }, 501)),
]
