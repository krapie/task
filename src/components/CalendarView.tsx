import { useMemo } from 'react'
import type { CalendarEvent, Addition } from '../types'

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MAX_LANES = 3
// Vertical layout constants (px) — keep in sync with CSS .calendar-week row height
const DAY_NUM_H = 28   // space reserved for the day number badge
const LANE_H    = 22   // height of each event lane slot

function pad(n: number) { return String(n).padStart(2, '0') }
function dateStr(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}` }
function todayStr() { const n = new Date(); return dateStr(n.getFullYear(), n.getMonth() + 1, n.getDate()) }
function dayOfWeek(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getDay() }
function diffDays(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000)
}

function buildWeeks(year: number, month: number): string[][] {
  const first = new Date(year, month - 1, 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  const weeks: string[][] = []
  for (let w = 0; w < 6; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      const c = new Date(start); c.setDate(start.getDate() + w * 7 + d)
      week.push(dateStr(c.getFullYear(), c.getMonth() + 1, c.getDate()))
    }
    weeks.push(week)
  }
  return weeks
}

type CalendarItem =
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'addition'; addition: Addition }

function itemId(item: CalendarItem)    { return item.kind === 'event' ? item.event.id         : item.addition.id }
function itemStart(item: CalendarItem) { return item.kind === 'event' ? item.event.start_date  : item.addition.slot_date }
function itemEnd(item: CalendarItem)   { return item.kind === 'event' ? item.event.end_date    : item.addition.slot_date }
function itemTitle(item: CalendarItem) { return item.kind === 'event' ? item.event.title       : item.addition.text }

interface PositionedItem {
  item: CalendarItem
  colStart: number
  colSpan: number
  isStart: boolean
  isEnd: boolean
  lane: number
}

function layoutWeek(weekDates: string[], items: CalendarItem[]): PositionedItem[] {
  const weekStart = weekDates[0], weekEnd = weekDates[6]
  const overlapping = items
    .filter(i => itemStart(i) <= weekEnd && itemEnd(i) >= weekStart)
    .sort((a, b) => {
      const da = diffDays(itemStart(a), itemEnd(a))
      const db_ = diffDays(itemStart(b), itemEnd(b))
      return da !== db_ ? db_ - da : itemStart(a).localeCompare(itemStart(b))
    })

  const placed: PositionedItem[] = []
  for (const item of overlapping) {
    const effStart = itemStart(item) < weekStart ? weekStart : itemStart(item)
    const effEnd   = itemEnd(item)   > weekEnd   ? weekEnd   : itemEnd(item)
    const colStart = dayOfWeek(effStart) + 1
    const colSpan  = dayOfWeek(effEnd) - dayOfWeek(effStart) + 1
    const colEnd   = colStart + colSpan - 1
    let lane = 0
    while (placed.some(p => p.lane === lane && !(p.colStart + p.colSpan - 1 < colStart || p.colStart > colEnd))) lane++
    placed.push({ item, colStart, colSpan, isStart: itemStart(item) >= weekStart, isEnd: itemEnd(item) <= weekEnd, lane })
  }
  return placed
}

interface CalendarWeekProps {
  weekDates: string[]
  events: CalendarEvent[]
  additions: Addition[]
  todosByDate: Record<string, number>
  today: string
  selectedDate: string | null
  currentMonth: number
  onDayClick: (date: string) => void
  onEventClick: (event: CalendarEvent) => void
}

function CalendarWeek({ weekDates, events, additions, todosByDate, today, selectedDate, currentMonth, onDayClick, onEventClick }: CalendarWeekProps) {
  const items = useMemo<CalendarItem[]>(() => [
    ...events.map(e => ({ kind: 'event' as const, event: e })),
    ...additions.map(a => ({ kind: 'addition' as const, addition: a })),
  ], [events, additions])
  const positioned = useMemo(() => layoutWeek(weekDates, items), [weekDates, items])

  // Count overflow per column (items with lane >= MAX_LANES)
  const overflowByCol: Record<number, number> = {}
  for (const pe of positioned) {
    if (pe.lane >= MAX_LANES) {
      for (let c = pe.colStart; c < pe.colStart + pe.colSpan; c++) {
        overflowByCol[c] = (overflowByCol[c] ?? 0) + 1
      }
    }
  }
  const visibleItems = positioned.filter(pe => pe.lane < MAX_LANES)

  return (
    <div className="calendar-week">
      {/* Day number cells — grid-row: 1, background fills full cell height */}
      {weekDates.map((date, i) => {
        const col = i + 1
        const [, m] = date.split('-').map(Number)
        return (
          <div
            key={date}
            className={[
              'calendar-day-cell',
              m !== currentMonth ? 'other-month' : '',
              date === today ? 'today' : '',
              date === selectedDate ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            style={{ gridRow: 1, gridColumn: col }}
            onClick={() => onDayClick(date)}
          >
            <span className="calendar-day-num">{parseInt(date.split('-')[2])}</span>
            {todosByDate[date] > 0 && <span className="calendar-todo-dot" />}
          </div>
        )
      })}

      {/* Event and addition bars — same grid-row: 1, overlaid on day cells via DOM order */}
      {visibleItems.map(pe => {
        const { item } = pe
        return (
          <div
            key={`${itemId(item)}-${itemStart(item)}-${pe.colStart}`}
            className={[
              'event-bar',
              item.kind === 'addition' ? 'is-addition' : '',
              pe.isStart ? 'is-start' : 'is-continuation',
              pe.isEnd ? 'is-end' : '',
            ].filter(Boolean).join(' ')}
            style={{
              gridRow: 1,
              gridColumn: `${pe.colStart} / span ${pe.colSpan}`,
              marginTop: `${DAY_NUM_H + pe.lane * LANE_H}px`,
            }}
            onClick={e => {
              e.stopPropagation()
              if (item.kind === 'addition') onDayClick(item.addition.slot_date)
              else onEventClick(item.event)
            }}
          >
            {pe.isStart && <span className="event-bar-title">{itemTitle(item)}</span>}
            {pe.isStart && item.kind === 'event' && item.event.time && pe.colSpan === 1 && (
              <span className="event-bar-time">{item.event.time}</span>
            )}
            {pe.isStart && item.kind === 'event' && item.event.recurrence && (
              <span className="event-bar-recurrence" aria-label="recurring">↻</span>
            )}
          </div>
        )
      })}

      {/* Overflow counts — positioned at the lane after the last visible one */}
      {weekDates.map((date, i) => {
        const col = i + 1
        const count = overflowByCol[col]
        if (!count) return null
        return (
          <span
            key={`overflow-${date}`}
            className="calendar-overflow-count"
            style={{ gridRow: 1, gridColumn: col, marginTop: `${DAY_NUM_H + MAX_LANES * LANE_H}px` }}
            onClick={() => onDayClick(date)}
          >
            +{count}
          </span>
        )
      })}
    </div>
  )
}

interface CalendarViewProps {
  year: number
  month: number
  events: CalendarEvent[]
  additions: Addition[]
  todosByDate: Record<string, number>
  selectedDate: string | null
  onPrevMonth: () => void
  onNextMonth: () => void
  onDayClick: (date: string) => void
  onEventClick: (event: CalendarEvent) => void
}

export function CalendarView({ year, month, events, additions, todosByDate, selectedDate, onPrevMonth, onNextMonth, onDayClick, onEventClick }: CalendarViewProps) {
  const today = todayStr()
  const weeks = useMemo(() => buildWeeks(year, month), [year, month])

  return (
    <div className="calendar-view">
      <div className="calendar-nav">
        <button className="icon-btn" onClick={onPrevMonth} aria-label="Previous month">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <span className="calendar-month-label">{MONTH_NAMES[month - 1]} {year}</span>
        <button className="icon-btn" onClick={onNextMonth} aria-label="Next month">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      <div className="calendar-grid">
        <div className="calendar-headers">
          {DAY_HEADERS.map(h => <div key={h} className="calendar-day-header">{h}</div>)}
        </div>
        <div className="calendar-body">
          {weeks.map(weekDates => (
            <CalendarWeek
              key={weekDates[0]}
              weekDates={weekDates}
              events={events}
              additions={additions}
              todosByDate={todosByDate}
              today={today}
              selectedDate={selectedDate}
              currentMonth={month}
              onDayClick={onDayClick}
              onEventClick={onEventClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
