import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import {
  eventDensity, relativeDay, todayCounts, todayItems, todayString, undatedTodos, upcomingEvents,
  type DayData, type TodayItem, type TodayKind,
} from '../lib/overview'
import { useRemote } from '../lib/useRemote'
import type { CalendarEvent, MailThread, MailUnreadCounts, Slot, Template, TodoItem } from '../types'
import { Ring } from './Charts'
import { Panel } from './OverviewPanel'
import OverviewSecure, { type SecureView } from './OverviewSecure'
import { Empty, Loading } from './Ui'

// Today on one desktop screen, in two bands. Upper: what is left today, the next calendar events and the
// inbox. Lower (owner only, behind the passkey step-up): health, assets and the trader (OverviewSecure).
// Today and the events come from App's own state, so a tick here is the same write as a tick on the Tasks
// board; mail is the Overview's own request.

interface Props {
  isAuth: boolean
  isOwner: boolean
  // The floating chat button sits in the bottom-right corner; the last panel keeps clear of it.
  chatButton: boolean
  ready: boolean
  templates: Record<Slot, Template[]>
  dailyData: Record<string, DayData>
  events: CalendarEvent[]
  todos: TodoItem[]
  activeSlot: Slot
  activeSlotDate: string
  rotateHour: number
  rotateMinute: number
  onToggleRoutine: (id: string) => void
  onToggleBonus: (id: string) => void
  onToggleEvent: (id: string) => void
  onToggleTodo: (id: string) => void
  onOpenTasks: () => void
  onOpenCalendar: (date: string) => void
  onOpenMail: () => void
  onOpenLife: (view: SecureView) => void
  onMailUnread: (n: number) => void
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

const GROUPS: { kind: TodayKind; label: string }[] = [
  { kind: 'event', label: 'Schedule' },
  { kind: 'routine', label: 'Routines' },
  { kind: 'bonus', label: 'Bonus' },
  { kind: 'todo', label: 'Todos' },
]

const WEEKDAY = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' })
}

export function OverviewView(p: Props) {
  // A minute tick keeps "today" right when the tab stays open across the day rotation.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])
  const today = todayString(p.rotateHour, p.rotateMinute)
  // Overdue todos ticked here stay listed (as done) until the Overview is left, so a mis-tap can be undone.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())

  const items = useMemo(
    () => todayItems(p.activeSlot, p.activeSlotDate, p.templates, p.dailyData[p.activeSlotDate], p.events, p.isAuth ? p.todos : [], today, ticked),
    [p.activeSlot, p.activeSlotDate, p.templates, p.dailyData, p.events, p.todos, p.isAuth, today, ticked],
  )
  const counts = useMemo(() => todayCounts(items), [items])
  const today_ = items.filter(i => !i.later)
  const left = today_.filter(i => !i.done).length
  const upcoming = useMemo(() => upcomingEvents(p.events, today), [p.events, today])
  const density = useMemo(() => eventDensity(p.events, today), [p.events, today])
  const densityMax = Math.max(...density.map(d => d.n), 1)
  const undated = p.isAuth ? undatedTodos(p.todos) : 0

  const mail = useRemote<{ counts: MailUnreadCounts; latest: MailThread[] }>(p.isAuth, async () => {
    const [c, latest] = await Promise.all([api.mail.unreadCounts(), api.mail.getThreads({ unread: true, category: 'general', limit: 6 })])
    return { counts: c, latest }
  })
  const generalUnread = mail.data?.counts.general
  useEffect(() => { if (generalUnread != null) p.onMailUnread(generalUnread) }, [generalUnread]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (i: TodayItem) => {
    if (i.kind === 'event') p.onToggleEvent(i.id)
    else if (i.kind === 'routine') p.onToggleRoutine(i.id)
    else if (i.kind === 'bonus') p.onToggleBonus(i.id)
    else { setTicked(prev => new Set(prev).add(i.id)); p.onToggleTodo(i.id) }
  }

  const row = (i: TodayItem) => (
    <li key={`${i.kind}:${i.id}`} className="ov-row">
      <button
        type="button"
        className={`task-checkbox${i.done ? ' checked' : ''}`}
        onClick={() => toggle(i)}
        aria-label={i.done ? 'Mark incomplete' : 'Mark complete'}
      ><CheckIcon /></button>
      <button type="button" className={`ov-row-text${i.done ? ' done' : ''}`} onClick={p.onOpenTasks}>{i.text}</button>
      {i.meta && <span className={`ov-meta${i.overdue ? ' ov-late' : ''}`}>{i.meta}</span>}
    </li>
  )

  const doneAll = today_.length > 0 && left === 0

  return (
    <div className={`ov${p.chatButton ? ' ov-chat-clear' : ''}${p.isOwner ? ' ov-has-secure' : ''}`}>
      <div className={`ov-band ov-top${p.isAuth ? '' : ' ov-top-guest'}`}>
        <Panel title="Today" count={p.ready ? (left ? `${left} left` : today_.length ? 'all done' : '') : ''} onOpen={p.onOpenTasks} className="ov-today">
          {!p.ready ? <Loading rows={6} /> : items.length === 0 ? (
            <Empty compact icon="routine" title="Nothing planned today" hint="Routines, bonus tasks, events and todos due today show up here." />
          ) : (
            <>
              {today_.length > 0 && <div className="ov-glance">
                <Ring value={today_.length - left} max={Math.max(today_.length, 1)} size={60} stroke={5} label="Done today">
                  <b className="ov-ring-n">{today_.length - left}<span>/{today_.length}</span></b>
                </Ring>
                <ul className="ov-legend">
                  {GROUPS.filter(g => counts[g.kind].total > 0).map(g => (
                    <li key={g.kind}><span>{g.label}</span><b>{counts[g.kind].done}/{counts[g.kind].total}</b></li>
                  ))}
                </ul>
              </div>}
              <div className="ov-scroll">
                {doneAll && <p className="ov-quiet">Everything for today is done.</p>}
                {GROUPS.map(g => {
                  const rows = items.filter(i => i.kind === g.kind)
                  return rows.length ? (
                    <div key={g.kind} className="ov-group">
                      <div className="ov-sub">{g.label}</div>
                      <ul className="ov-list">{rows.map(row)}</ul>
                    </div>
                  ) : null
                })}
              </div>
            </>
          )}
          {undated > 0 && (
            <button type="button" className="ov-foot" onClick={p.onOpenTasks}>
              {undated} todo{undated === 1 ? '' : 's'} without a date
            </button>
          )}
        </Panel>

        <Panel title="Upcoming events" onOpen={() => p.onOpenCalendar(today)} className="ov-events">
          {!p.ready ? <Loading rows={4} /> : (
            <>
              <div className="ov-density" aria-label="Events in the next 14 days">
                {density.map(d => (
                  <span key={d.date} className="ov-density-col" title={`${d.date}: ${d.n} event${d.n === 1 ? '' : 's'}`}>
                    <span className="ov-density-bar" style={{ height: `${d.n ? 20 + (d.n / densityMax) * 80 : 8}%`, opacity: d.n ? 1 : 0.35 }} />
                  </span>
                ))}
                <span className="ov-density-note">next 14 days</span>
              </div>
              {upcoming.length === 0 ? <p className="ov-quiet">No events in the next 60 days.</p> : (
                <ul className="ov-list ov-scroll">
                  {upcoming.map((e, i) => (
                    <li key={e.id}>
                      <button type="button" className="ov-event" onClick={() => p.onOpenCalendar(e.date)}>
                        <span className={`ov-tile${upcoming[i - 1]?.date === e.date ? ' ov-tile-same' : ''}`}>
                          <i>{WEEKDAY(e.date)}</i><b>{Number(e.date.slice(8))}</b>
                        </span>
                        <span className="ov-event-body">
                          <span className="ov-event-title">{e.title}</span>
                          <span className="ov-meta">{[e.meta, relativeDay(e.date, today)].filter(Boolean).join(' · ')}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>

        {p.isAuth && (
          <Panel title="Inbox" onOpen={p.onOpenMail} className="ov-inbox">
            {mail.failed && !mail.data ? <p className="ov-quiet">Mail is unavailable right now.</p>
              : !mail.data ? <Loading rows={4} />
              : (
                <>
                  <div className="ov-unread">
                    <b>{mail.data.counts.general}</b>
                    <span>unread{mail.data.counts.others > 0 ? ` · ${mail.data.counts.others} in Others` : ''}</span>
                  </div>
                  {mail.data.latest.length === 0 ? <p className="ov-quiet">No unread mail.</p> : (
                    <ul className="ov-list ov-scroll">
                      {mail.data.latest.map(t => {
                        const from = t.from_name || t.from_address
                        return (
                          <li key={t.id}>
                            <button type="button" className="ov-mailrow" onClick={p.onOpenMail}>
                              <span className="ov-avatar" aria-hidden="true">{from.trim().charAt(0).toUpperCase() || '?'}</span>
                              <span className="ov-mailbody">
                                <span className="ov-mailtop"><b>{from}</b><span className="ov-meta">{timeAgo(t.received_at)}</span></span>
                                <span className="ov-mailsubject">{t.subject || '(no subject)'}</span>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              )}
          </Panel>
        )}
      </div>

      {p.isOwner && <OverviewSecure isAuth={p.isAuth} onOpen={p.onOpenLife} />}
    </div>
  )
}
