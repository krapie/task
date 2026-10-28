export type Slot = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'weekend'
export type WorkWeek = 'mon-fri' | 'tue-sat' | 'sun-thu'

export interface Template {
  id: string
  slot: Slot
  text: string
  position: number
  group_id: string | null
  created_at: number
}

export interface TemplateWithState extends Template {
  completed: boolean
  skipped: boolean
}

export interface Addition {
  id: string
  slot_date: string
  text: string
  completed: boolean
  created_at: number
}

export interface Settings {
  rotateHour: number
  rotateMinute: number
  keepBonus: boolean
  workWeek: WorkWeek
  taskNotifyEnabled?: boolean
  taskNotifyHour?: number
  taskNotifyMinute?: number
  taskNotifyTz?: string
}

export interface ExportData {
  version: number
  exported_at: string
  templates: Record<Slot, Template[]>
  settings: Settings
}

export interface DailyData {
  slotDate: string
  slot: Slot
  templates: TemplateWithState[]
  completionIds: string[]
  additions: Addition[]
  eventCompletions: string[]
  skipIds?: string[]
}

export type Recurrence = 'weekly' | 'monthly' | 'yearly'

export interface CalendarEvent {
  id: string
  title: string
  start_date: string
  end_date: string
  time: string | null
  recurrence: Recurrence | null
  created_at: number
}

export interface DailyEvent {
  id: string
  title: string
  time: string | null
  completed: boolean
}

export interface MailAccount {
  id: string
  label: string
  email: string
  host: string
  port: number
  tls: boolean
  username: string
  last_synced: string | null
}

// State of the mail-bridge background sync (one runs at a time).
export interface MailSyncStatus {
  running: boolean
  started?: boolean
  finished_at: string | null
  synced: number | null
  error: string | null
}

export type MailCategory = 'general' | 'others'

export interface MailUnreadCounts {
  general: number
  others: number
}

export interface MailSenderRule {
  from_address: string
  category: MailCategory
  created_at: string
}

export interface MailItem {
  id: string
  account_id: string
  message_id: string
  thread_id?: string | null
  subject: string
  from_address: string
  from_name: string | null
  received_at: string
  read: boolean
  flagged: boolean
  category?: MailCategory
  snippet: string | null
  body?: string | null
  html_body?: string | null
  translated_body?: string | null
  translated_html?: string | null
  translated_lang?: string | null
}

// A conversation: the latest message's fields plus thread-wide counts.
// `id` is the latest message's id (used for push deep links and as a row key helper).
export interface MailThread {
  id: string
  account_id: string
  thread_id: string
  subject: string
  from_address: string
  from_name: string | null
  received_at: string
  snippet: string | null
  count: number
  unread_count: number
  flagged: boolean
  category?: MailCategory
  participants: string[]
}

export interface TodoItem {
  id: string
  text: string
  completed: boolean
  due_date: string | null
  created_at: string
}

export interface NewsItem {
  title: string
  link: string
  published: string
  author: string
  preview: string | null
  flagged: boolean
}

export interface GoalItem {
  id: string
  category_id: string
  text: string
  completed: boolean
  crossed_out: boolean
  note: string | null
  position: number
}

export interface GoalCategory {
  id: string
  period_id: string
  name: string
  position: number
  items: GoalItem[]
}

export type GoalPeriodKind = 'half' | 'general' | 'year' | 'retro'

export interface GoalPeriod {
  id: string
  kind: GoalPeriodKind
  // 'half': both set. 'year': year set, half null. 'general' singleton: both null.
  year: number | null
  half: 1 | 2 | null
  categories: GoalCategory[]
}

export interface AssetSummary {
  netWorth: number
  totalAssets: number
  totalDebt: number
  creditScore: number | null
  categoryBreakdown: { category: string; amount: number }[]
  investment: { principal: number; value: number; pnl: number }
  thisMonth: { income: number; expense: number; netSavings: number }
}

export interface FinanceStatus {
  lastIngest: { source_file: string; ingested_at: string; rows_total: number; rows_new: number; rows_updated: number } | null
  transactionCount: number
  dateRange: [string | null, string | null]
}

export interface FinanceNotifySettings {
  financeNotifyEnabled: string
  financeNotifyDay: string
  financeNotifyHour: string
  financeNotifyMinute: string
}

// Apple Health aggregates (GET /api/health-data/summary, passkey step-up).
// Everything is as of `asOf`, the last day of the latest manual export.
export interface HealthSummary {
  asOf: string | null
  exportedAt: string | null
  importedAt: string | null
  day: {
    steps: number | null
    activeKcal: number | null; activeGoal: number | null
    exerciseMin: number | null; exerciseGoal: number | null
    standHours: number | null; standGoal: number | null
  } | null
  week: { stepsAvg: number | null; sleepAvgH: number | null; restingHr: number | null; hrvMs: number | null } | null
  vo2max: { value: number; at: string } | null
  lastNight: {
    night: string; asleepH: number | null; deepH: number | null; coreH: number | null
    remH: number | null; awakeH: number | null; bedtime: string | null; wakeTime: string | null
  } | null
  // The last 14 nights up to asOf, oldest first; a night without a record is absent. Optional: older ingests lack it.
  sleepNights?: { night: string; asleepH: number | null; deepH: number | null; coreH: number | null; remH: number | null; awakeH: number | null }[]
  runs: { at: string; km: number | null; durationMin: number | null; paceMinKm: number | null; avgHr: number | null }[]
}

// A browser subscribed to Web Push (one row per device).
export interface PushDevice {
  endpoint: string
  username: string | null
  user_agent: string | null
  created_at: string
}

// ── Assistant (operator personal profile) ──
export type AssistantFolder = 'summaries' | 'markets' | 'money' | 'health' | 'tasks' | 'mail' | 'life' | 'other'
export interface AssistantSummary { id: string; title: string; folder: AssistantFolder | null; created_at: string; updated_at: string; turns: number; streaming: boolean }

export type AssistantPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: { error: boolean; output: string } }

export interface AssistantTurn {
  id: string
  question: string
  parts: AssistantPart[]
  state: 'streaming' | 'done' | 'error'
  notice?: string | null
  error?: string | null
  status?: string
  done?: { ok: boolean; duration_ms: number; reason?: string } | null
}

export interface AssistantConversation { id: string; title: string; created_at: string; updated_at: string; turns: AssistantTurn[] }

export type AssistantEvent =
  | { type: 'conversation'; id: string; turn_id: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; error: boolean; output: string }
  | { type: 'status'; message: string }
  | { type: 'reset'; notice?: string }
  | { type: 'done'; ok: boolean; duration_ms: number; reason?: string }
  | { type: 'error'; message: string }

// ── Notes (searched and read by the assistant) ──
export interface NoteSummary { key: string; title: string; created_at: string; updated_at: string; chars: number; snippet: string }
export interface Note { key: string; title: string; body: string; created_at: string; updated_at: string }

// ── Trader (summary from ops, passkey step-up; docs/apps/trader.md "Task app") ──
export interface TraderEtf {
  code: string; name: string
  // target, gain_pct and share are fractions (0.65 is 65 %)
  target: number
  qty: number; avg: number; price: number; value: number; gain: number; gain_pct: number; share: number
  series: [string, number][]
}
export interface TraderBuy {
  period: string; date: string; state: string; tier: string | null
  // ret and bench are fractions
  bought: number; value_now: number; ret: number; bench: number
}
export interface TraderSummary {
  env: 'paper' | 'real'
  generated_at: string
  trader: { holdings_value: number; invested: number; gain: number; gain_pct: number; daytrade_net: number; cash: number; total_value: number; as_of: string | null; source: 'broker' | 'fills'; history?: [string, number][] }
  portfolio: { value: number; cost: number; gain: number; gain_pct: number; as_of: string | null; history: [string, number, number][] }
  etfs: TraderEtf[]
  buys: { rows: TraderBuy[]; n: number; bought: number; value_now: number; ret: number; enough: boolean; min_buys: number }
  checks: { id: string; status: 'ok' | 'info' | 'warn' | 'bad' }[]
  verdict: { level: 'clear' | 'attention' | 'bad'; bad: number; warn: number }
}
