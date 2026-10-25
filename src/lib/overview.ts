import type { Addition, CalendarEvent, GoalPeriod, Slot, Template, TodoItem } from '../types'
import { addDays, diffDays, expandForDate, expandForView } from './recurrence'
import { formatDate } from './slots'

// What the Overview shows, derived from the state App already holds (no requests of its own).

export interface DayData {
  completions: string[]
  additions: Addition[]
  eventCompletions: string[]
  skips?: string[]
}

export type TodayKind = 'event' | 'routine' | 'bonus' | 'todo'

export interface TodayItem {
  kind: TodayKind
  id: string
  text: string
  done: boolean
  // Mono text on the right: an event's time, or how late a todo is.
  meta?: string
  overdue?: boolean
}

// "Today" follows the day rotation like the board does: before the rotate hour it is still yesterday.
export function todayString(rotateHour = 0, rotateMinute = 0, now = new Date()): string {
  const beforeRotate = now.getHours() * 60 + now.getMinutes() < rotateHour * 60 + rotateMinute
  return formatDate(beforeRotate ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now)
}

function dueMeta(due: string, today: string): { meta: string; overdue: boolean } {
  const late = diffDays(due, today)
  return late > 0 ? { meta: `${late}d late`, overdue: true } : { meta: 'due today', overdue: false }
}

// Routines, bonus items and single-day events of one slot day, counted like the Tasks header counts them.
export function slotDay(
  slot: Slot,
  slotDate: string,
  templates: Record<Slot, Template[]>,
  day: DayData | undefined,
  events: CalendarEvent[],
) {
  const d = day ?? { completions: [], additions: [], eventCompletions: [] }
  const routines = (templates[slot] ?? []).filter(t => !d.skips?.includes(t.id))
  const dayEvents = expandForDate(events, slotDate)
    .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
  const done = routines.filter(t => d.completions.includes(t.id)).length
    + d.additions.filter(a => a.completed).length
    + dayEvents.filter(e => d.eventCompletions.includes(e.id)).length
  const total = routines.length + d.additions.length + dayEvents.length
  return { routines, additions: d.additions, events: dayEvents, completions: d.completions, eventCompletions: d.eventCompletions, done, total }
}

// The Today list: open items first (timed events, routines, bonus, todos due), finished ones after.
export function todayItems(
  slot: Slot,
  slotDate: string,
  templates: Record<Slot, Template[]>,
  day: DayData | undefined,
  events: CalendarEvent[],
  todos: TodoItem[],
  today: string,
  // Overdue todos ticked on the Overview stay listed (as done) until it is left, so a mis-tap can be undone.
  keep: ReadonlySet<string> = new Set(),
): TodayItem[] {
  const s = slotDay(slot, slotDate, templates, day, events)
  const items: TodayItem[] = [
    ...s.events.map<TodayItem>(e => ({ kind: 'event', id: e.id, text: e.title, done: s.eventCompletions.includes(e.id), meta: e.time ?? 'all day' })),
    ...s.routines.map<TodayItem>(t => ({ kind: 'routine', id: t.id, text: t.text, done: s.completions.includes(t.id) })),
    ...s.additions.map<TodayItem>(a => ({ kind: 'bonus', id: a.id, text: a.text, done: a.completed, meta: 'bonus' })),
    ...todos
      .filter(t => t.due_date && t.due_date <= today && !(t.completed && t.due_date < today && !keep.has(t.id)))
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      .map<TodayItem>(t => ({ kind: 'todo', id: t.id, text: t.text, done: t.completed, ...dueMeta(t.due_date as string, today) })),
  ]
  return [...items.filter(i => !i.done), ...items.filter(i => i.done)]
}

export interface UpcomingEvent {
  id: string
  date: string
  title: string
  // Mono text on the right: the time, and "until MM-DD" for a multi-day event.
  meta?: string
}

const dateLabel = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// The next events from tomorrow on (today's are in the Today list), nearest first. A multi-day event
// that already started shows on tomorrow, the first day it is still running.
export function upcomingEvents(events: CalendarEvent[], today: string, limit = 8, horizonDays = 60): (UpcomingEvent & { label: string })[] {
  const start = addDays(today, 1)
  return expandForView(events, start, addDays(today, horizonDays))
    .map<UpcomingEvent>(e => {
      const date = e.start_date > start ? e.start_date : start
      return {
        id: `${e.id}:${date}`, date, title: e.title,
        meta: [e.time, e.end_date > e.start_date ? `until ${e.end_date.slice(5)}` : null].filter(Boolean).join(' · ') || undefined,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.meta ?? '').localeCompare(b.meta ?? ''))
    .slice(0, limit)
    .map(e => ({ ...e, label: dateLabel(e.date) }))
}

export const undatedTodos = (todos: TodoItem[]) => todos.filter(t => !t.completed && !t.due_date).length

export interface GoalsProgress {
  label: string
  categories: { id: string; name: string; done: number; total: number }[]
  next: string[]
}

// This half-year's goals: per category the done / counted items (crossed-out ones don't count), and the first open items.
export function goalsProgress(periods: GoalPeriod[], now = new Date()): GoalsProgress | null {
  const year = now.getFullYear()
  const half = now.getMonth() < 6 ? 1 : 2
  const period = periods.find(p => p.kind === 'half' && p.year === year && p.half === half)
  if (!period) return null
  const categories = period.categories.map(c => {
    const counted = c.items.filter(i => !i.crossed_out)
    return { id: c.id, name: c.name, done: counted.filter(i => i.completed).length, total: counted.length }
  })
  const next = period.categories.flatMap(c => c.items.filter(i => !i.completed && !i.crossed_out).map(i => i.text)).slice(0, 3)
  return { label: `H${half} ${year}`, categories, next }
}
