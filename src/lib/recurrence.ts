import type { CalendarEvent } from '../types'

export function pad(n: number) { return String(n).padStart(2, '0') }

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000)
}

// Expand recurring events to their visible occurrences within [viewStart, viewEnd].
// Non-recurring events are passed through if they overlap the range.
// The original `id` is always preserved so API edit/delete still works.
export function expandForView(events: CalendarEvent[], viewStart: string, viewEnd: string): CalendarEvent[] {
  const result: CalendarEvent[] = []
  for (const e of events) {
    if (!e.recurrence) {
      if (e.start_date <= viewEnd && e.end_date >= viewStart) result.push(e)
      continue
    }
    const [origY, origM, origD] = e.start_date.split('-').map(Number)
    const dur = diffDays(e.start_date, e.end_date)
    if (e.recurrence === 'yearly') {
      const [vy] = viewStart.split('-').map(Number)
      for (let y = vy - 1; y <= vy + 1; y++) {
        const ns = `${y}-${pad(origM)}-${pad(origD)}`
        const ne = dur > 0 ? addDays(ns, dur) : ns
        if (ns <= viewEnd && ne >= viewStart) result.push({ ...e, start_date: ns, end_date: ne })
      }
    } else if (e.recurrence === 'monthly') {
      const [vy, vm] = viewStart.split('-').map(Number)
      for (let offset = -1; offset <= 3; offset++) {
        const dt = new Date(vy, vm - 1 + offset, origD)
        if (dt.getDate() !== origD) continue
        const ns = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(origD)}`
        const ne = dur > 0 ? addDays(ns, dur) : ns
        if (ns <= viewEnd && ne >= viewStart) result.push({ ...e, start_date: ns, end_date: ne })
      }
    } else if (e.recurrence === 'weekly') {
      const origDow = new Date(origY, origM - 1, origD).getDay()
      const [vy, vm, vd] = viewStart.split('-').map(Number)
      const vsDate = new Date(vy, vm - 1, vd)
      const daysDiff = (origDow - vsDate.getDay() + 7) % 7
      const first = new Date(vsDate)
      first.setDate(vsDate.getDate() + daysDiff)
      const origDate = new Date(origY, origM - 1, origD)
      for (let cur = new Date(first); ; cur.setDate(cur.getDate() + 7)) {
        if (cur < origDate) continue
        const ns = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`
        if (ns > viewEnd) break
        result.push({ ...e, start_date: ns, end_date: ns })
      }
    }
  }
  return result
}

// Expand recurring events for a single date (for board view bonus tasks).
export function expandForDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  const [, currM, currD] = date.split('-').map(Number)
  const currDow = new Date(date).getDay()
  const result: CalendarEvent[] = []
  for (const e of events) {
    if (!e.recurrence) {
      if (e.start_date === date && e.end_date === date) result.push(e)
      continue
    }
    const [, origM, origD] = e.start_date.split('-').map(Number)
    if (e.recurrence === 'yearly' && origM === currM && origD === currD) {
      result.push({ ...e, start_date: date, end_date: date })
    } else if (e.recurrence === 'monthly' && origD === currD) {
      result.push({ ...e, start_date: date, end_date: date })
    } else if (e.recurrence === 'weekly' && new Date(e.start_date).getDay() === currDow) {
      result.push({ ...e, start_date: date, end_date: date })
    }
  }
  return result
}

// Compute the [viewStart, viewEnd] range for the 6-week calendar view
export function calendarViewRange(year: number, month: number): { start: string; end: string } {
  const first = new Date(year, month - 1, 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  const end = new Date(start)
  end.setDate(start.getDate() + 41)
  return {
    start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    end: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
  }
}
