// Synthetic, in-memory state for the staging build (docs/staging.md). Nothing here is real data.
// Typed against the app's own types so a changed shape fails `tsc`. A page reload resets it.
import type { Addition, AssetSummary, CalendarEvent, GoalPeriod, HealthSummary, MailAccount, MailItem, MailSenderRule, NewsItem, Settings, Slot, Template, TodoItem, TraderSummary } from '../types'

const day = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
export { day }

const tpl = (id: string, slot: Slot, text: string, position: number, group_id: string | null = null): Template => ({ id, slot, text, position, group_id, created_at: Date.now() - 86_400_000 * 30 })

export const templates: Record<Slot, Template[]> = {
  mon: [tpl('t1', 'mon', 'Plan the week', 0), tpl('t2', 'mon', 'Review goals', 1)],
  tue: [tpl('t3', 'tue', 'Gym', 0)],
  wed: [tpl('t4', 'wed', 'Read 20 pages', 0), tpl('t5', 'wed', 'Gym', 1)],
  thu: [tpl('t6', 'thu', 'Gym', 0)],
  fri: [tpl('t7', 'fri', 'Weekly review', 0), tpl('t8', 'fri', 'Backup check', 1)],
  weekend: [tpl('t9', 'weekend', 'Long walk', 0), tpl('t10', 'weekend', 'Meal prep', 1)],
}
export const completions = new Set<string>() // `${templateId}|${slotDate}`
export const skips = new Set<string>()
export const additions: Addition[] = [
  { id: 'a1', slot_date: day(), text: 'Renew passport (mock)', completed: false, created_at: Date.now() - 3_600_000 },
  { id: 'a2', slot_date: day(), text: 'Call the dentist (mock)', completed: true, created_at: Date.now() - 7_200_000 },
]
export const eventCompletions = new Set<string>() // `${eventId}|${slotDate}`

export const settings: Settings = { rotateHour: 4, rotateMinute: 0, keepBonus: true, workWeek: 'mon-fri', taskNotifyEnabled: false, taskNotifyHour: 9, taskNotifyMinute: 0, taskNotifyTz: 'Asia/Seoul' }

export const events: CalendarEvent[] = [
  { id: 'e4', title: 'Standup (mock)', start_date: day(), end_date: day(), time: '09:30', recurrence: null, created_at: Date.now() },
  { id: 'e1', title: 'Dentist (mock)', start_date: day(2), end_date: day(2), time: '14:30', recurrence: null, created_at: Date.now() },
  { id: 'e2', title: 'Rent due (mock)', start_date: day(-5), end_date: day(-5), time: null, recurrence: 'monthly', created_at: Date.now() },
  { id: 'e5', title: 'Team lunch (mock)', start_date: day(4), end_date: day(4), time: '12:00', recurrence: null, created_at: Date.now() },
  { id: 'e6', title: 'Piano lesson (mock)', start_date: day(1), end_date: day(1), time: '19:00', recurrence: 'weekly', created_at: Date.now() },
  { id: 'e7', title: 'Parents visit (mock)', start_date: day(19), end_date: day(19), time: null, recurrence: null, created_at: Date.now() },
  { id: 'e3', title: 'Trip (mock)', start_date: day(6), end_date: day(9), time: null, recurrence: null, created_at: Date.now() },
]

export const todos: TodoItem[] = [
  { id: 'td1', text: 'Book flights (mock)', completed: false, due_date: day(3), created_at: iso(60 * 20) },
  { id: 'td2', text: 'Reply to landlord (mock)', completed: false, due_date: day(-1), created_at: iso(60 * 48) },
  { id: 'td6', text: 'Renew the gym membership (mock)', completed: false, due_date: day(2), created_at: iso(60 * 30) },
  { id: 'td7', text: 'File the quarterly tax form (mock)', completed: false, due_date: day(9), created_at: iso(60 * 40) },
  { id: 'td4', text: 'Send the invoice (mock)', completed: false, due_date: day(), created_at: iso(60 * 5) },
  { id: 'td5', text: 'Sort the photo backlog (mock)', completed: false, due_date: null, created_at: iso(60 * 70) },
  { id: 'td3', text: 'Buy a keyboard (mock)', completed: true, due_date: null, created_at: iso(60 * 90) },
]

const year = new Date().getFullYear()
const half = new Date().getMonth() < 6 ? 1 : 2
export const goals: GoalPeriod[] = [
  { id: 'gp1', kind: 'year', year, half: null, categories: [
    { id: 'gc1', period_id: 'gp1', name: 'Health', position: 0, items: [
      { id: 'gi1', category_id: 'gc1', text: 'Run a 10k', completed: true, crossed_out: false, note: null, position: 0 },
      { id: 'gi2', category_id: 'gc1', text: 'Sleep 7h on weekdays', completed: false, crossed_out: false, note: 'Mock note', position: 1 },
    ] },
    { id: 'gc2', period_id: 'gp1', name: 'Work', position: 1, items: [
      { id: 'gi3', category_id: 'gc2', text: 'Ship the staging environment', completed: false, crossed_out: false, note: null, position: 0 },
    ] },
  ] },
  { id: 'gp3', kind: 'half', year, half, categories: [
    { id: 'gc4', period_id: 'gp3', name: 'Health', position: 0, items: [
      { id: 'gi5', category_id: 'gc4', text: 'Run twice a week', completed: true, crossed_out: false, note: null, position: 0 },
      { id: 'gi6', category_id: 'gc4', text: 'Book a checkup', completed: false, crossed_out: false, note: null, position: 1 },
    ] },
    { id: 'gc5', period_id: 'gp3', name: 'Work', position: 1, items: [
      { id: 'gi7', category_id: 'gc5', text: 'Write the Q4 plan', completed: false, crossed_out: false, note: null, position: 0 },
      { id: 'gi8', category_id: 'gc5', text: 'Ship the staging environment', completed: true, crossed_out: false, note: null, position: 1 },
      { id: 'gi9', category_id: 'gc5', text: 'Retire the old cron host', completed: false, crossed_out: false, note: null, position: 2 },
    ] },
  ] },
  { id: 'gp2', kind: 'general', year: null, half: null, categories: [
    { id: 'gc3', period_id: 'gp2', name: 'Someday', position: 0, items: [
      { id: 'gi4', category_id: 'gc3', text: 'Learn to sail', completed: false, crossed_out: false, note: null, position: 0 },
    ] },
  ] },
]

export const news: NewsItem[] = [
  { title: 'Another mock headline about open-source licensing and what it means for small teams', link: 'https://example.test/c', published: iso(60 * 1), author: 'Example News', preview: null, flagged: false },
  { title: 'A mock headline about databases', link: 'https://example.test/a', published: iso(60 * 3), author: 'Example News', preview: 'Short preview text of the article.', flagged: false },
  { title: 'Another mock headline about the weather', link: 'https://example.test/b', published: iso(60 * 8), author: 'Example News', preview: null, flagged: true },
]

export const mailAccounts: MailAccount[] = [{ id: 'ma1', label: 'Personal', email: 'kevin@example.test', host: 'imap.example.test', port: 993, tls: true, username: 'kevin', last_synced: iso(12) }]
export const mailSenderRules: MailSenderRule[] = []
export const mailItems: MailItem[] = [
  { id: 'mi1', account_id: 'ma1', message_id: '<1@example.test>', thread_id: 'th1', subject: 'Your invoice for October (mock)', from_address: 'billing@example.test', from_name: 'Billing', received_at: iso(90), read: false, flagged: false, snippet: 'Amount due 12,000 KRW by Friday.', body: 'Amount due 12,000 KRW by Friday.' },
  { id: 'mi5', account_id: 'ma1', message_id: '<5@example.test>', thread_id: 'th5', subject: 'Standup notes from this morning (mock)', from_address: 'lee@example.test', from_name: 'Minji Lee', received_at: iso(200), read: false, flagged: false, snippet: 'Notes attached.', body: 'Notes attached.' },
  { id: 'mi6', account_id: 'ma1', message_id: '<6@example.test>', thread_id: 'th6', subject: 'Your package is out for delivery (mock)', from_address: 'ship@example.test', from_name: 'Parcel Service', received_at: iso(60 * 5), read: false, flagged: false, snippet: 'Arriving today.', body: 'Arriving today.' },
  { id: 'mi7', account_id: 'ma1', message_id: '<7@example.test>', thread_id: 'th7', subject: 'Re: Dinner on Friday? (mock)', from_address: 'friend2@example.test', from_name: 'Jun Park', received_at: iso(60 * 9), read: false, flagged: false, snippet: 'Works for me.', body: 'Works for me.' },
  { id: 'mi2', account_id: 'ma1', message_id: '<2@example.test>', thread_id: 'th2', subject: 'Weekend plans (mock)', from_address: 'friend@example.test', from_name: 'A Friend', received_at: iso(60 * 20), read: true, flagged: true, snippet: 'Are we still on for Saturday?', body: 'Are we still on for Saturday?' },
  { id: 'mi3', account_id: 'ma1', message_id: '<3@example.test>', thread_id: 'th3', subject: '(광고) 20% off everything this weekend (mock)', from_address: 'sale@shop.example.test', from_name: 'Mock Shop', received_at: iso(30), read: false, flagged: false, category: 'others', snippet: 'Limited time offer, unsubscribe any time.', body: 'Limited time offer, unsubscribe any time.' },
  { id: 'mi4', account_id: 'ma1', message_id: '<4@example.test>', thread_id: 'th4', subject: 'Newsletter: this week in mock (mock)', from_address: 'news@letters.example.test', from_name: 'Mock Letters', received_at: iso(60 * 5), read: false, flagged: false, category: 'others', snippet: 'Five links worth your time.', body: 'Five links worth your time.' },
]

// ── Private data behind the passkey step-up (Assets, Health, Trader) ──
// A smooth wobble, so the sparklines have a shape without random numbers.
const wave = (n: number, from: number, to: number, amp = 0.02) =>
  Array.from({ length: n }, (_, i) => Math.round((from + ((to - from) * i) / (n - 1)) * (1 + amp * Math.sin(i * 0.9))))

export const assetSummary: AssetSummary = {
  netWorth: 184_320_000, totalAssets: 212_000_000, totalDebt: 27_680_000, creditScore: 912,
  categoryBreakdown: [
    { category: 'Investments', amount: 78_000_000 }, { category: 'Savings', amount: 62_000_000 },
    { category: 'Deposit', amount: 50_000_000 }, { category: 'Cash', amount: 12_000_000 }, { category: 'Pension', amount: 7_000_000 }, { category: 'Other', amount: 3_000_000 },
  ],
  investment: { principal: 70_000_000, value: 78_000_000, pnl: 8_000_000 },
  thisMonth: { income: 4_800_000, expense: 3_150_000, netSavings: 1_650_000 },
}

export const healthSummary: HealthSummary = {
  asOf: day(-1), exportedAt: iso(60 * 20), importedAt: iso(60 * 19),
  day: { steps: 8432, activeKcal: 410, activeGoal: 600, exerciseMin: 26, exerciseGoal: 30, standHours: 9, standGoal: 12 },
  week: { stepsAvg: 7960, sleepAvgH: 7.1, restingHr: 58, hrvMs: 46 },
  vo2max: { value: 44.2, at: day(-9) },
  lastNight: { night: day(-1), asleepH: 7.2, deepH: 1.1, coreH: 3.9, remH: 1.6, awakeH: 0.6, bedtime: '23:40', wakeTime: '07:05' },
  runs: [
    { at: iso(60 * 30), km: 5.2, durationMin: 31, paceMinKm: 5.96, avgHr: 152 },
    { at: iso(60 * 100), km: 8.0, durationMin: 49, paceMinKm: 6.1, avgHr: 148 },
  ],
}

const etf = (code: string, name: string, target: number, qty: number, avg: number, price: number, from: number): TraderSummary['etfs'][number] => {
  const value = qty * price
  return {
    code, name, target, qty, avg, price, value, gain: value - qty * avg, gain_pct: (price - avg) / avg, share: 0,
    series: wave(40, from, price).map((v, i) => [day(-40 + i), v] as [string, number]),
  }
}
const etfs = [
  etf('379800', 'KODEX 미국S&P500', 0.65, 16, 23035, 23180, 21800),
  etf('379810', 'KODEX 미국나스닥100', 0.2, 7, 25880, 26095, 24400),
  etf('390390', 'KODEX 미국반도체MV', 0.08, 12, 12100, 12350, 11300),
  etf('441640', 'KODEX 미국AI전력핵심인프라', 0.07, 9, 12040, 12130, 11500),
]
const etfTotal = etfs.reduce((t, e) => t + e.value, 0)
etfs.forEach((e) => { e.share = e.value / etfTotal })

export const traderSummary: TraderSummary = {
  env: 'paper', generated_at: iso(1),
  trader: { holdings_value: etfTotal, invested: etfs.reduce((t, e) => t + e.qty * e.avg, 0), gain: etfs.reduce((t, e) => t + e.gain, 0), gain_pct: 0.0101, daytrade_net: -12_400, cash: 9_450_280, total_value: 9_450_280 + etfTotal, as_of: iso(60 * 5), source: 'broker' },
  portfolio: {
    value: 78_000_000, cost: 70_000_000, gain: 8_000_000, gain_pct: 0.114, as_of: day(-1),
    history: wave(60, 60_000_000, 78_000_000, 0.015).map((v, i) => [day(-60 + i), v, Math.round(52_000_000 + (18_000_000 * i) / 59)] as [string, number, number]),
  },
  etfs,
  buys: {
    n: 5, bought: 2_750_000, value_now: 2_811_000, ret: 0.022, enough: false, min_buys: 13,
    rows: [0, 1, 2, 3, 4].map((i) => ({
      period: `2026-W${String(43 - i).padStart(2, '0')}`, date: day(-5 - i * 7), state: i === 0 ? 'done' : 'done', tier: i === 2 ? 'front-load' : null,
      bought: 549_720, value_now: 549_720 * (1 + 0.004 * (5 - i)), ret: 0.004 * (5 - i), bench: 0.0035 * (5 - i),
    })),
  },
  checks: [{ id: 'weekly_buy', status: 'ok' }, { id: 'day_trader', status: 'ok' }, { id: 'orders', status: 'ok' }, { id: 'alarms', status: 'ok' }, { id: 'prices', status: 'ok' }, { id: 'snapshot', status: 'warn' }, { id: 'shadow', status: 'ok' }, { id: 'real_lock', status: 'ok' }],
  verdict: { level: 'attention', bad: 0, warn: 1 },
}
