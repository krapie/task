export type Slot = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'weekend'
export type WorkWeek = 'mon-fri' | 'tue-sat' | 'sun-thu'

export interface Template {
  id: string
  slot: Slot
  text: string
  position: number
  created_at: number
}

export interface TemplateWithState extends Template {
  completed: boolean
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
  showAgent?: boolean
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

export interface MailItem {
  id: string
  account_id: string
  message_id: string
  subject: string
  from_address: string
  from_name: string | null
  received_at: string
  read: boolean
  flagged: boolean
  snippet: string | null
  body?: string | null
  html_body?: string | null
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

export type AgentTaskStatus = 'queued' | 'running' | 'waiting_quota' | 'gating' | 'done' | 'failed' | 'canceled'

export interface AgentTask {
  id: number
  title: string
  prompt: string | null
  repo: string
  session: string | null
  status: AgentTaskStatus
  branch: string | null
  error: string | null
  summary: string | null
  pr_number: number | null
  pr_url: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}
