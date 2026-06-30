import { useMemo } from 'react'
import type { CalendarEvent } from '../types'

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MAX_LANES = 3

function pad(n: number) { return String(n).padStart(2, '0') }

function dateStr(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function todayStr() {
  const n = new Date()
  return dateStr(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

function dayOfWeek(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000)
}

function buildWeeks(year: number, month: number): string[][] {
  const firstOfMonth = new Date(year, month - 1, 1)
  const start = new Date(firstOfMonth)
  start.setDate(1 - firstOfMonth.getDay())

  const weeks: string[][] = []
  for (let w = 0; w < 6; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      const cell = new Date(start)
      cell.setDate(start.getDate() + w * 7 + d)
      week.push(dateStr(cell.getFullYear(), cell.getMonth() + 1, cell.getDate()))
    }
    weeks.push(week)
  }
  return weeks
}

interface PositionedEvent {
  event: CalendarEvent
  colStart: number
  colSpan: number
  isStart: boolean
  isEnd: boolean
  lane: number
}

function layoutWeek(weekDates: string[], events: CalendarEvent[]): PositionedEvent[] {
  const weekStart = weekDates[0]
  const weekEnd = weekDates[6]

  const overlapping = events.filter(e => e.start_date <= weekEnd && e.end_date >= weekStart)
  overlapping.sort((a, b) => {
    const diff = diffDays(b.start_date, b.end_date) - diffDays(a.start_date, a.end_date)
    return diff !== 0 ? diff : a.start_date.localeCompare(b.start_date)
  })

  const placed: PositionedEvent[] = []

  for (const event of overlapping) {
    const effStart = event.start_date < weekStart ? weekStart : event.start_date
    const effEnd = event.end_date > weekEnd ? weekEnd : event.end_date
    const colStart = dayOfWeek(effStart) + 1
    const colSpan = dayOfWeek(effEnd) - dayOfWeek(effStart) + 1
    const colEnd = colStart + colSpan - 1

    let lane = 0
    while (placed.some(p => p.lane === lane && !(p.colStart + p.colSpan - 1 < colStart || p.colStart > colEnd))) {
      lane++
    }

    placed.push({ event, colStart, colSpan, isStart: event.start_date >= weekStart, isEnd: event.end_date <= weekEnd, lane })
  }

  return placed
}

interface CalendarWeekProps {
  weekDates: string[]
  events: CalendarEvent[]
  today: string
  selectedDate: string | null
  currentMonth: number
  onDayClick: (date: string) => void
  onEventClick: (event: CalendarEvent) => void
}

function CalendarWeek({ weekDates, events, today, selectedDate, currentMonth, onDayClick, onEventClick }: CalendarWeekProps) {
  const positioned = useMemo(() => layoutWeek(weekDates, events), [weekDates, events])

  const overflowByCol: Record<number, number> = {}
  for (const pe of positioned) {
    if (pe.lane >= MAX_LANES) {
      for (let c = pe.colStart; c < pe.colStart + pe.colSpan; c++) {
        overflowByCol[c] = (overflowByCol[c] ?? 0) + 1
      }
    }
  }

  const visibleEvents = positioned.filter(pe => pe.lane < MAX_LANES)

  return (
    <div className="calendar-week">
      {/* Day number cells — explicit grid-row:1, grid-column:N so event bars can share the same grid */}
      {weekDates.map((date, i) => {
        const col = i + 1
        const [, m] = date.split('-').map(Number)
        const isToday = date === today
        const isSelected = date === selectedDate
        const overflow = overflowByCol[col]
        return (
          <div
            key={date}
            className={[
              'calendar-day-cell',
              m !== currentMonth ? 'other-month' : '',
              isToday ? 'today' : '',
              isSelected ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            style={{ gridRow: 1, gridColumn: col }}
            onClick={() => onDayClick(date)}
          >
            <span className="calendar-day-num">{parseInt(date.split('-')[2])}</span>
            {overflow != null && <span className="calendar-overflow-count">+{overflow}</span>}
          </div>
        )
      })}

      {/*
        Event area background — covers rows 2–5 with bg color + background-image column lines.
        Must come before event bars in DOM so bars render on top (CSS Grid DOM-order stacking).
      */}
      <div className="cal-event-area" />

      {/* Event bars — direct grid children so they span true grid columns */}
      {visibleEvents.map(pe => (
        <div
          key={`${pe.event.id}-${pe.event.start_date}-${pe.colStart}`}
          className={[
            'event-bar',
            pe.isStart ? 'is-start' : 'is-continuation',
            pe.isEnd ? 'is-end' : '',
          ].filter(Boolean).join(' ')}
          style={{ gridRow: pe.lane + 2, gridColumn: `${pe.colStart} / span ${pe.colSpan}` }}
          onClick={e => { e.stopPropagation(); onEventClick(pe.event) }}
        >
          {pe.isStart && <span className="event-bar-title">{pe.event.title}</span>}
          {pe.isStart && pe.event.time && pe.colSpan === 1 && (
            <span className="event-bar-time">{pe.event.time}</span>
          )}
          {pe.isStart && pe.event.recurrence && (
            <span className="event-bar-recurrence" aria-label="recurring">↻</span>
          )}
        </div>
      ))}
    </div>
  )
}

interface CalendarViewProps {
  year: number
  month: number
  events: CalendarEvent[]
  selectedDate: string | null
  onPrevMonth: () => void
  onNextMonth: () => void
  onDayClick: (date: string) => void
  onEventClick: (event: CalendarEvent) => void
}

export function CalendarView({ year, month, events, selectedDate, onPrevMonth, onNextMonth, onDayClick, onEventClick }: CalendarViewProps) {
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
          {DAY_HEADERS.map(h => (
            <div key={h} className="calendar-day-header">{h}</div>
          ))}
        </div>
        <div className="calendar-body">
          {weeks.map(weekDates => (
            <CalendarWeek
              key={weekDates[0]}
              weekDates={weekDates}
              events={events}
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
