import type { Slot, Template, Addition, Settings, ExportData, CalendarEvent, DailyEvent } from '../types'

const KEYS = {
  TEMPLATES: 'task_templates',
  DAILY: 'task_daily',
  SETTINGS: 'task_settings',
  EVENTS: 'calendar_events',
  EVENT_COMPLETIONS: 'calendar_event_completions',
}

type StoredTemplates = Record<Slot, Template[]>
type StoredDailyEntry = { additions: Addition[]; completions: string[] }
type StoredDaily = Record<string, StoredDailyEntry>

const DEFAULT_SETTINGS: Settings = { rotateHour: 6, rotateMinute: 0, keepBonus: false }
const DEFAULT_TEMPLATES: StoredTemplates = { mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [] }

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export const storage = {
  getTemplates: (): StoredTemplates =>
    ({ ...DEFAULT_TEMPLATES, ...load<StoredTemplates>(KEYS.TEMPLATES, DEFAULT_TEMPLATES) }),

  setTemplates: (t: StoredTemplates): void => save(KEYS.TEMPLATES, t),

  getSettings: (): Settings =>
    ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(KEYS.SETTINGS, {}) }),

  setSettings: (s: Settings): void => save(KEYS.SETTINGS, s),

  getDaily: (slotDate: string): StoredDailyEntry => {
    const all = load<StoredDaily>(KEYS.DAILY, {})
    return all[slotDate] ?? { additions: [], completions: [] }
  },

  setDaily: (slotDate: string, data: StoredDailyEntry): void => {
    const all = load<StoredDaily>(KEYS.DAILY, {})
    all[slotDate] = data
    save(KEYS.DAILY, all)
  },

  getEvents: (): CalendarEvent[] => load<CalendarEvent[]>(KEYS.EVENTS, []),

  setEvents: (events: CalendarEvent[]): void => save(KEYS.EVENTS, events),

  getEventCompletionsForDate: (slotDate: string): string[] => {
    const all = load<Record<string, string[]>>(KEYS.EVENT_COMPLETIONS, {})
    return all[slotDate] ?? []
  },

  toggleEventCompletion: (eventId: string, slotDate: string, completed: boolean): void => {
    const all = load<Record<string, string[]>>(KEYS.EVENT_COMPLETIONS, {})
    const existing = all[slotDate] ?? []
    if (completed && !existing.includes(eventId)) {
      all[slotDate] = [...existing, eventId]
    } else if (!completed) {
      all[slotDate] = existing.filter(id => id !== eventId)
    }
    save(KEYS.EVENT_COMPLETIONS, all)
  },

  getEventsForDate: (slotDate: string): DailyEvent[] => {
    const events = storage.getEvents()
    const completions = new Set(storage.getEventCompletionsForDate(slotDate))
    return events
      .filter(e => e.start_date <= slotDate && e.end_date >= slotDate)
      .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
      .map(e => ({ id: e.id, title: e.title, time: e.time, completed: completions.has(e.id) }))
  },

  export: (): ExportData => ({
    version: 1,
    exported_at: new Date().toISOString(),
    templates: storage.getTemplates(),
    settings: storage.getSettings(),
  }),

  import: (data: ExportData, mode: 'merge' | 'replace'): void => {
    if (mode === 'replace') {
      storage.setTemplates(data.templates)
      storage.setSettings(data.settings)
      return
    }
    const existing = storage.getTemplates()
    const merged = { ...existing }
    for (const slot of Object.keys(data.templates) as Slot[]) {
      const existingTexts = new Set((existing[slot] ?? []).map(t => t.text))
      const newItems = (data.templates[slot] ?? []).filter(t => !existingTexts.has(t.text))
      merged[slot] = [...(existing[slot] ?? []), ...newItems]
    }
    storage.setTemplates(merged)
  },
}
