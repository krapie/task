export type Slot = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'weekend'

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
