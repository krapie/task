import type { Addition, CalendarEvent, Slot, Template, TodoItem } from '../types'
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

export interface UpcomingItem {
  id: string
  kind: 'event' | 'task'
  date: string
  title: string
  // Mono text under the title: an event's time (and "until MM-DD" for a multi-day one); a task says "task".
  meta?: string
}

// The next events and tasks (todos with a due date) from tomorrow on, nearest first; today's are in the Today list.
// A multi-day event that already started shows on tomorrow, the first day it is still running. On one day the
// events come before the tasks.
export function upcomingItems(events: CalendarEvent[], todos: TodoItem[], today: string, limit = 8, horizonDays = 60): UpcomingItem[] {
  const start = addDays(today, 1)
  const end = addDays(today, horizonDays)
  const evs = expandForView(events, start, end).map<UpcomingItem>(e => {
    const date = e.start_date > start ? e.start_date : start
    return {
      id: `${e.id}:${date}`, kind: 'event', date, title: e.title,
      meta: [e.time, e.end_date > e.start_date ? `until ${e.end_date.slice(5)}` : null].filter(Boolean).join(' · ') || undefined,
    }
  })
  const tasks = todos
    .filter(t => !t.completed && t.due_date && t.due_date >= start && t.due_date <= end)
    .map<UpcomingItem>(t => ({ id: `task:${t.id}`, kind: 'task', date: t.due_date as string, title: t.text, meta: 'task' }))
  return [...evs, ...tasks]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? (a.meta ?? '').localeCompare(b.meta ?? '') : a.kind === 'event' ? -1 : 1))
    .slice(0, limit)
}

export const undatedTodos = (todos: TodoItem[]) => todos.filter(t => !t.completed && !t.due_date).length

// Open and finished items per kind, for the Today ring and its legend.
export function todayCounts(items: TodayItem[]): Record<TodayKind, { done: number; total: number }> {
  const out: Record<TodayKind, { done: number; total: number }> = {
    event: { done: 0, total: 0 }, routine: { done: 0, total: 0 }, bonus: { done: 0, total: 0 }, todo: { done: 0, total: 0 },
  }
  for (const i of items) {
    out[i.kind].total++
    if (i.done) out[i.kind].done++
  }
  return out
}

// Events and tasks due per day over the next `days` days from tomorrow (a multi-day event counts on every day it runs).
export function eventDensity(events: CalendarEvent[], todos: TodoItem[], today: string, days = 14): { date: string; n: number }[] {
  const start = addDays(today, 1)
  const expanded = expandForView(events, start, addDays(today, days))
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i)
    return {
      date,
      n: expanded.filter(e => e.start_date <= date && e.end_date >= date).length + todos.filter(t => !t.completed && t.due_date === date).length,
    }
  })
}

// "Tomorrow", "in 3 days"
export function relativeDay(date: string, today: string): string {
  const d = diffDays(today, date)
  return d === 1 ? 'Tomorrow' : `in ${d} days`
}
