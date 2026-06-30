import { useMemo } from 'react'
import type { CalendarEvent } from '../types'

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function padDate(n: number) { return String(n).padStart(2, '0') }

function dateStr(y: number, m: number, d: number) {
  return `${y}-${padDate(m)}-${padDate(d)}`
}

function todayStr() {
  const n = new Date()
  return dateStr(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

interface Cell {
  date: string
  day: number
  currentMonth: boolean
}

function buildCells(year: number, month: number): Cell[] {
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const daysInPrev = new Date(year, month - 1, 0).getDate()
  const cells: Cell[] = []

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i
    const pm = month === 1 ? 12 : month - 1
    const py = month === 1 ? year - 1 : year
    cells.push({ date: dateStr(py, pm, d), day: d, currentMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: dateStr(year, month, d), day: d, currentMonth: true })
  }
  const remaining = 42 - cells.length
  const nm = month === 12 ? 1 : month + 1
  const ny = month === 12 ? year + 1 : year
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: dateStr(ny, nm, d), day: d, currentMonth: false })
  }
  return cells
}

interface CalendarViewProps {
  year: number
  month: number
  events: CalendarEvent[]
  selectedDate: string | null
  onPrevMonth: () => void
  onNextMonth: () => void
  onDayClick: (date: string) => void
}

export function CalendarView({ year, month, events, selectedDate, onPrevMonth, onNextMonth, onDayClick }: CalendarViewProps) {
  const today = todayStr()
  const cells = useMemo(() => buildCells(year, month), [year, month])

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const e of events) {
      for (const cell of cells) {
        if (cell.date >= e.start_date && cell.date <= e.end_date) {
          if (!map[cell.date]) map[cell.date] = []
          map[cell.date].push(e)
        }
      }
    }
    return map
  }, [events, cells])

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
        {DAY_HEADERS.map(h => (
          <div key={h} className="calendar-day-header">{h}</div>
        ))}
        {cells.map(cell => {
          const dayEvents = eventsByDate[cell.date] ?? []
          const visible = dayEvents.slice(0, 2)
          const overflow = dayEvents.length - visible.length
          const isToday = cell.date === today
          const isSelected = cell.date === selectedDate

          return (
            <div
              key={cell.date}
              className={[
                'calendar-cell',
                cell.currentMonth ? '' : 'other-month',
                isToday ? 'today' : '',
                isSelected ? 'selected' : '',
                dayEvents.length > 0 ? 'has-events' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onDayClick(cell.date)}
            >
              <span className="calendar-day-num">{cell.day}</span>
              <div className="calendar-events">
                {visible.map(e => (
                  <div key={e.id} className="event-chip">
                    {e.time && <span className="event-chip-time">{e.time}</span>}
                    <span className="event-chip-title">{e.title}</span>
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="event-chip-overflow">+{overflow} more</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
