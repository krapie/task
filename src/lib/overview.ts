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
  // A suggestion below today's todos (due later or undated): listed, but not part of today's ring and counts.
  later?: boolean
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

// The Today list: open items first (timed events, routines, bonus, todos due), finished ones after, then a few
// later or undated todos as suggestions.
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
  laterLimit = 5,
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
  const later = todos
    .filter(t => (!t.completed || keep.has(t.id)) && !(t.due_date && t.due_date <= today))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, laterLimit)
    .map<TodayItem>(t => ({ kind: 'todo', id: t.id, text: t.text, done: t.completed, meta: t.due_date ? t.due_date.slice(5) : 'no date', later: true }))
  return [...items.filter(i => !i.done), ...items.filter(i => i.done), ...later]
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
export function upcomingEvents(events: CalendarEvent[], today: string, limit = 5, horizonDays = 60): (UpcomingEvent & { label: string })[] {
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

// Open and finished items per kind, for the Today ring and its legend.
export function todayCounts(items: TodayItem[]): Record<TodayKind, { done: number; total: number }> {
  const out: Record<TodayKind, { done: number; total: number }> = {
    event: { done: 0, total: 0 }, routine: { done: 0, total: 0 }, bonus: { done: 0, total: 0 }, todo: { done: 0, total: 0 },
  }
  for (const i of items) {
    if (i.later) continue
    out[i.kind].total++
    if (i.done) out[i.kind].done++
  }
  return out
}

// Events per day over the next `days` days from tomorrow (a multi-day event counts on every day it runs).
export function eventDensity(events: CalendarEvent[], today: string, days = 14): { date: string; n: number }[] {
  const start = addDays(today, 1)
  const expanded = expandForView(events, start, addDays(today, days))
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i)
    return { date, n: expanded.filter(e => e.start_date <= date && e.end_date >= date).length }
  })
}

// "Tomorrow", "in 3 days"
export function relativeDay(date: string, today: string): string {
  const d = diffDays(today, date)
  return d === 1 ? 'Tomorrow' : `in ${d} days`
}
