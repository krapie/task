import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import {
  goalsProgress, todayItems, todayString, undatedTodos, upcomingEvents,
  type DayData, type GoalsProgress, type TodayItem,
} from '../lib/overview'
import type { CalendarEvent, MailThread, MailUnreadCounts, NewsItem, Slot, Template, TodoItem } from '../types'
import { Empty, Loading, Meter } from './Ui'

// Today on one desktop screen: what is left today, the next calendar events, and, signed in, goals and
// the inbox; the news feed is public. Today and the events come from App's own state, so a tick here
// is the same write as a tick on the Tasks board. Goals, mail and news are the Overview's own requests.

interface Props {
  isAuth: boolean
  // The floating chat button sits in the bottom-right corner; the last column keeps clear of it.
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
  onOpenGoals: () => void
  onOpenMail: () => void
  onOpenNews: () => void
  onMailUnread: (n: number) => void
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

function Panel({ title, count, onOpen, className = '', children }: { title: string; count?: string; onOpen?: () => void; className?: string; children: React.ReactNode }) {
  return (
    <section className={`ov-panel ${className}`}>
      <header className="ov-head">
        {onOpen
          ? <button type="button" className="ov-title ov-title-link" onClick={onOpen}>{title}</button>
          : <span className="ov-title">{title}</span>}
        {count && <span className="ov-count">{count}</span>}
      </header>
      {children}
    </section>
  )
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(m, 0)}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// Goals, mail and news are the Overview's own requests, each refreshed every 5 minutes.
function useRemote<T>(enabled: boolean, load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({ data: null, failed: false })
  useEffect(() => {
    if (!enabled) { setState({ data: null, failed: false }); return }
    let live = true
    const run = () => load().then(
      data => { if (live) setState({ data, failed: false }) },
      () => { if (live) setState(s => ({ ...s, failed: true })) },
    )
    run()
    const id = setInterval(() => { if (!document.hidden) run() }, 5 * 60 * 1000)
    return () => { live = false; clearInterval(id) }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

export function OverviewView(p: Props) {
  // A minute tick keeps "today" right when the tab stays open across the day rotation.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])
  const today = todayString(p.rotateHour, p.rotateMinute)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())

  const items = useMemo(
    () => todayItems(p.activeSlot, p.activeSlotDate, p.templates, p.dailyData[p.activeSlotDate], p.events, p.isAuth ? p.todos : [], today, ticked),
    [p.activeSlot, p.activeSlotDate, p.templates, p.dailyData, p.events, p.todos, p.isAuth, today, ticked],
  )
  const open = items.filter(i => !i.done)
  const done = items.filter(i => i.done)
  const upcoming = useMemo(() => upcomingEvents(p.events, today), [p.events, today])
  const undated = p.isAuth ? undatedTodos(p.todos) : 0

  const goals = useRemote<{ progress: GoalsProgress | null }>(p.isAuth, () => api.goals.getAll().then(ps => ({ progress: goalsProgress(ps) })))
  const mail = useRemote<{ counts: MailUnreadCounts; latest: MailThread[] }>(p.isAuth, async () => {
    const [counts, latest] = await Promise.all([api.mail.unreadCounts(), api.mail.getThreads({ unread: true, category: 'general', limit: 3 })])
    return { counts, latest }
  })
  const news = useRemote<NewsItem[]>(true, () => api.news.getItems())
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

  return (
    <div className="ov">
      <Panel title="Today" count={p.ready ? (open.length ? `${open.length} left` : items.length ? 'all done' : '') : ''} onOpen={p.onOpenTasks} className="ov-today">
        {!p.ready ? <Loading rows={6} /> : items.length === 0 ? (
          <Empty compact icon="routine" title="Nothing planned today" hint="Routines, bonus tasks, events and todos due today show up here." />
        ) : (
          <div className="ov-scroll">
            {open.length === 0 && <p className="ov-quiet">Everything for today is done.</p>}
            <ul className="ov-list">{open.map(row)}</ul>
            {done.length > 0 && (
              <>
                <div className="ov-sub">Done · {done.length}</div>
                <ul className="ov-list">{done.map(row)}</ul>
              </>
            )}
          </div>
        )}
        {undated > 0 && (
          <button type="button" className="ov-foot" onClick={p.onOpenTasks}>
            {undated} todo{undated === 1 ? '' : 's'} without a date
          </button>
        )}
      </Panel>

      <div className="ov-side">
        <Panel title="Upcoming events" className="ov-events" onOpen={() => p.onOpenCalendar(today)}>
          {!p.ready ? <Loading rows={4} /> : upcoming.length === 0 ? <p className="ov-quiet">No events in the next 60 days.</p> : (
            <ul className="ov-list ov-scroll">
              {upcoming.map(e => (
                <li key={e.id}>
                  <button type="button" className="ov-event" onClick={() => p.onOpenCalendar(e.date)}>
                    <span className="ov-event-date">{e.label}</span>
                    <span className="ov-agenda-text">{e.title}</span>
                    {e.meta && <span className="ov-meta">{e.meta}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {p.isAuth && (
          <Panel title="Inbox" count={generalUnread != null ? `${generalUnread} unread` : ''} onOpen={p.onOpenMail} className="ov-inbox">
            {mail.failed && !mail.data ? <p className="ov-quiet">Mail is unavailable right now.</p>
              : !mail.data ? <Loading rows={3} />
              : mail.data.latest.length === 0 ? <p className="ov-quiet">No unread mail.</p> : (
                <ul className="ov-list">
                  {mail.data.latest.map(t => (
                    <li key={t.id}>
                      <button type="button" className="ov-agenda ov-mail" onClick={p.onOpenMail}>
                        <span className="ov-agenda-text">{t.subject || '(no subject)'}</span>
                        <span className="ov-meta ov-mail-from">{t.from_name || t.from_address}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </Panel>
        )}
      </div>

      <div className="ov-side">
        {p.isAuth && (
          <Panel title="Goals" count={goals.data?.progress?.label} onOpen={p.onOpenGoals} className="ov-goals">
            {goals.failed && !goals.data ? <p className="ov-quiet">Goals are unavailable right now.</p>
              : !goals.data ? <Loading rows={3} />
              : !goals.data.progress ? <p className="ov-quiet">No goals set for this half-year yet.</p> : (
                <div className="ov-scroll">
                  {goals.data.progress.categories.map(c => (
                    <div key={c.id} className="ov-goal">
                      <span className="ov-goal-name">{c.name}</span>
                      <span className="ov-meta">{c.done}/{c.total}</span>
                      <Meter value={c.done} max={c.total} label={`${c.name} progress`} />
                    </div>
                  ))}
                  {goals.data.progress.next.length > 0 && (
                    <>
                      <div className="ov-sub">Next up</div>
                      <ul className="ov-list">{goals.data.progress.next.map((t, n) => <li key={`${n}:${t}`} className="ov-plain">{t}</li>)}</ul>
                    </>
                  )}
                </div>
              )}
          </Panel>
        )}

        <Panel title="News" onOpen={p.onOpenNews} className="ov-news">
          {news.failed && !news.data ? <p className="ov-quiet">News is unavailable right now.</p>
            : !news.data ? <Loading rows={4} />
            : news.data.length === 0 ? <p className="ov-quiet">No headlines.</p> : (
              <ul className="ov-list ov-scroll">
                {news.data.slice(0, 8).map((n, idx) => (
                  <li key={`${idx}:${n.link}`}>
                    <a className="ov-headline" href={n.link} target="_blank" rel="noreferrer">
                      <span className="ov-headline-title">{n.title}</span>
                      <span className="ov-meta">{[n.author, n.published && timeAgo(n.published)].filter(Boolean).join(' · ')}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
      </div>
    </div>
  )
}
