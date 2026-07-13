import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { DayTabs } from './components/DayTabs'
import { RoutineBoard } from './components/RoutineBoard'
import { SettingsPanel, downloadExport } from './components/SettingsPanel'
import { SignInModal } from './components/SignInModal'
import { ImportModal } from './components/ImportModal'
import { CalendarView } from './components/CalendarView'
import { EventPanel } from './components/EventPanel'
import { MailInbox } from './components/MailInbox'
import { NewsView } from './components/NewsView'
import { TaskView } from './components/TaskView'
import { storage } from './lib/storage'
import { api } from './lib/api'
import { getActiveSlotDate, getNextSlotDate, getSlotLabels, getSlotOrder } from './lib/slots'
import type { Slot, Template, TemplateWithState, Addition, Settings, ExportData, DailyData, CalendarEvent, DailyEvent, Recurrence, TodoItem, AgentTask } from './types'

type Theme = 'light' | 'dark'
type View = 'routine' | 'task' | 'calendar' | 'mail' | 'news'

const SLOT_DAY_NAMES: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', weekend: 'Weekend',
}

function pad(n: number) { return String(n).padStart(2, '0') }

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000)
}

// Expand recurring events to their visible occurrences within [viewStart, viewEnd].
// Non-recurring events are passed through if they overlap the range.
// The original `id` is always preserved so API edit/delete still works.
function expandForView(events: CalendarEvent[], viewStart: string, viewEnd: string): CalendarEvent[] {
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
function expandForDate(events: CalendarEvent[], date: string): CalendarEvent[] {
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
function calendarViewRange(year: number, month: number): { start: string; end: string } {
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

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('task_theme') as Theme | null
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface SlotDailyData {
  completions: string[]
  additions: Addition[]
  eventCompletions: string[]
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('task_theme', theme)
  }, [theme])

  const [mailUnread, setMailUnread] = useState(0)
  useEffect(() => {
    document.title = mailUnread > 0 ? `(${mailUnread}) Task` : 'Task'
  }, [mailUnread])

  const [token, setToken] = useState<string | null>(() => localStorage.getItem('task_token'))
  const [username, setUsername] = useState<string | null>(null)
  const isAuth = token !== null

  const [settings, setSettings] = useState<Settings>({ rotateHour: 6, rotateMinute: 0, keepBonus: false, workWeek: 'mon-fri' })

  const [activeSlot, setActiveSlot] = useState<Slot>('mon')
  const [activeSlotDate, setActiveSlotDate] = useState<string>('')

  const [templates, setTemplates] = useState<Record<Slot, Template[]>>({
    mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [],
  })

  const [dailyData, setDailyData] = useState<Record<string, SlotDailyData>>({})
  const loadedDatesRef = useRef<Set<string>>(new Set())

  const [selectedSlot, setSelectedSlot] = useState<Slot>('mon')
  const [showSettings, setShowSettings] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [showImport, setShowImport] = useState(false)

  // Calendar state
  const [view, setView] = useState<View>('routine')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarAdditions, setCalendarAdditions] = useState<Addition[]>([])
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([])
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)

  // Derived: date for the currently selected slot
  const selectedSlotDate = activeSlotDate
    ? getNextSlotDate(selectedSlot, activeSlot, activeSlotDate, settings.workWeek)
    : ''
  const selectedDailyData: SlotDailyData = dailyData[selectedSlotDate] ?? { completions: [], additions: [], eventCompletions: [] }

  // Derived: single-day calendar events for selected slot date (board view bonus tasks)
  const selectedEvents: DailyEvent[] = useMemo(() => {
    if (!selectedSlotDate) return []
    return expandForDate(calendarEvents, selectedSlotDate)
      .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
      .map(e => ({
        id: e.id,
        title: e.title,
        time: e.time,
        completed: selectedDailyData.eventCompletions.includes(e.id),
      }))
  }, [calendarEvents, selectedSlotDate, selectedDailyData.eventCompletions])

  // Derived: events expanded for the full 6-week calendar view (includes recurring occurrences)
  const monthEvents = useMemo(() => {
    const { start, end } = calendarViewRange(calendarMonth.year, calendarMonth.month)
    return expandForView(calendarEvents, start, end)
  }, [calendarEvents, calendarMonth])

  // Derived: todos due on the selected slot date (shown in board)
  const dueTodos = useMemo(() =>
    todos.filter(t => t.due_date === selectedSlotDate),
    [todos, selectedSlotDate]
  )

  // Derived: count of incomplete todos per date (for calendar dots)
  const todosByDate = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of todos) {
      if (t.due_date && !t.completed) map[t.due_date] = (map[t.due_date] ?? 0) + 1
    }
    return map
  }, [todos])

  // Derived: todos due on the selected calendar date (for EventPanel)
  const calendarDayTodos = useMemo(() =>
    selectedCalendarDate ? todos.filter(t => t.due_date === selectedCalendarDate) : [],
    [todos, selectedCalendarDate]
  )

  // Derived: bonus task additions visible in the current calendar month view
  const monthAdditions = useMemo(() => {
    const { start, end } = calendarViewRange(calendarMonth.year, calendarMonth.month)
    return calendarAdditions.filter(a => a.slot_date >= start && a.slot_date <= end)
  }, [calendarAdditions, calendarMonth])

  // Derived: events for the selected calendar date (pre-expanded for EventPanel)
  const selectedDayEvents = useMemo(() => {
    if (!selectedCalendarDate) return []
    return expandForDate(calendarEvents, selectedCalendarDate)
      .concat(
        calendarEvents.filter(
          e => !e.recurrence && e.start_date <= selectedCalendarDate && e.end_date >= selectedCalendarDate && e.start_date !== e.end_date
        )
      )
  }, [calendarEvents, selectedCalendarDate])

  // Verify token on mount
  useEffect(() => {
    if (!token) return
    api.auth.me().then(u => setUsername(u.username)).catch(() => {
      localStorage.removeItem('task_token')
      setToken(null)
    })
  }, [token])

  const loadSettings = useCallback(async () => {
    if (isAuth) {
      const s = await api.settings.get().catch(() => storage.getSettings())
      setSettings(s)
      return s
    } else {
      const s = storage.getSettings()
      setSettings(s)
      return s
    }
  }, [isAuth])

  const refreshSlot = useCallback((s: Settings) => {
    const { slot, slotDate } = getActiveSlotDate(s.rotateHour, s.rotateMinute, s.workWeek ?? 'mon-fri')
    setActiveSlot(slot)
    setActiveSlotDate(slotDate)
    setSelectedSlot(prev => {
      if (prev === activeSlot || activeSlotDate === '') return slot
      return prev
    })
    return { slot, slotDate }
  }, [activeSlot, activeSlotDate])

  const loadTemplates = useCallback(async () => {
    if (isAuth) {
      const t = await api.templates.getAll().catch(() => storage.getTemplates())
      setTemplates(t)
    } else {
      const t = storage.getTemplates()
      setTemplates(t)
    }
  }, [isAuth])

  const loadAllEvents = useCallback(async () => {
    if (isAuth) {
      const events = await api.events.getAll().catch(() => [])
      setCalendarEvents(events)
    } else {
      setCalendarEvents(storage.getEvents())
    }
  }, [isAuth])

  const loadCalendarAdditions = useCallback(async (year: number, month: number) => {
    const { start, end } = calendarViewRange(year, month)
    if (isAuth) {
      const additions = await api.daily.getAdditionsRange(start, end).catch(() => [])
      setCalendarAdditions(additions)
    } else {
      setCalendarAdditions(storage.getAdditionsForRange(start, end))
    }
  }, [isAuth])

  const loadTodos = useCallback(async () => {
    if (isAuth) {
      const t = await api.todos.getAll().catch(() => [])
      setTodos(t)
    }
  }, [isAuth])

  const loadAgentTasks = useCallback(async () => {
    if (!isAuth) return
    const result = await api.agentq.list().catch(() => null)
    if (result) setAgentTasks(result.tasks)
  }, [isAuth])

  const loadDaily = useCallback(async (slotDate: string) => {
    if (!slotDate || loadedDatesRef.current.has(slotDate)) return
    loadedDatesRef.current.add(slotDate)
    if (isAuth) {
      const d = await api.daily.get(slotDate).catch(() => null) as DailyData | null
      if (!d) return
      const serverCompletions = d.templates.filter(t => t.completed).map(t => t.id)
      const serverAdditions = d.additions
      const serverEventCompletions = d.eventCompletions ?? []
      setDailyData(prev => {
        const existing = prev[slotDate]
        if (!existing) {
          return { ...prev, [slotDate]: { completions: serverCompletions, additions: serverAdditions, eventCompletions: serverEventCompletions } }
        }
        const serverIds = new Set(serverAdditions.map(a => a.id))
        const localOnly = existing.additions.filter(a => !serverIds.has(a.id) && !a.id.startsWith('temp-'))
        return {
          ...prev,
          [slotDate]: {
            completions: serverCompletions,
            additions: [...serverAdditions, ...localOnly],
            eventCompletions: serverEventCompletions,
          },
        }
      })
    } else {
      const d = storage.getDaily(slotDate)
      const eventCompletions = storage.getEventCompletionsForDate(slotDate)
      setDailyData(prev => {
        if (prev[slotDate]) return prev
        return { ...prev, [slotDate]: { ...d, eventCompletions } }
      })
    }
  }, [isAuth])

  // Bootstrap on auth change
  useEffect(() => {
    loadedDatesRef.current = new Set()
    setDailyData({})
    loadSettings().then(s => {
      const { slotDate } = refreshSlot(s)
      loadTemplates()
      loadDaily(slotDate)
      loadAllEvents()
      loadTodos()
      loadAgentTasks()
    })
  }, [isAuth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load daily data whenever selected slot changes
  useEffect(() => {
    if (!activeSlotDate) return
    const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate, settings.workWeek)
    loadDaily(slotDate)
  }, [selectedSlot, activeSlot, activeSlotDate, loadDaily])

  // Reload events and additions when switching to or navigating within calendar view
  useEffect(() => {
    if (view === 'calendar') {
      loadAllEvents()
      loadCalendarAdditions(calendarMonth.year, calendarMonth.month)
    }
  }, [view, calendarMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load agent tasks when switching to task view; poll every 15s while active non-terminal tasks exist
  useEffect(() => {
    if (view !== 'task' || !isAuth) return
    loadAgentTasks()
    const id = setInterval(() => {
      const hasActive = agentTasks.some(t => !['done', 'failed', 'canceled'].includes(t.status))
      if (hasActive) loadAgentTasks()
    }, 15000)
    return () => clearInterval(id)
  }, [view, isAuth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync all board data: templates + daily + events
  const [boardSyncing, setBoardSyncing] = useState(false)
  const syncBoardData = useCallback(async () => {
    if (!activeSlotDate) return
    setBoardSyncing(true)
    const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate, settings.workWeek)
    loadedDatesRef.current.delete(slotDate)
    await Promise.all([loadTemplates(), loadAllEvents(), loadDaily(slotDate)])
    setBoardSyncing(false)
  }, [activeSlotDate, selectedSlot, activeSlot, loadTemplates, loadAllEvents, loadDaily])

  // Refresh all data when the browser tab/window becomes visible again
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible' || !activeSlotDate) return
      const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate, settings.workWeek)
      loadedDatesRef.current.delete(slotDate)
      loadTemplates()
      loadAllEvents()
      loadDaily(slotDate)
      if (view === 'calendar') {
        loadCalendarAdditions(calendarMonth.year, calendarMonth.month)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [selectedSlot, activeSlot, activeSlotDate, view, calendarMonth, loadTemplates, loadAllEvents, loadDaily, loadCalendarAdditions])

  // Periodic auto-refresh every 5 minutes (when authenticated)
  useEffect(() => {
    if (!isAuth) return
    const id = setInterval(() => {
      if (!activeSlotDate) return
      const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate, settings.workWeek)
      loadedDatesRef.current.delete(slotDate)
      loadTemplates()
      loadAllEvents()
      loadDaily(slotDate)
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [isAuth, activeSlotDate, selectedSlot, activeSlot, loadTemplates, loadAllEvents, loadDaily])

  // Check for slot rollover every minute
  useEffect(() => {
    const id = setInterval(() => {
      const { slot, slotDate } = getActiveSlotDate(settings.rotateHour, settings.rotateMinute, settings.workWeek)
      if (slotDate !== activeSlotDate) {
        setActiveSlot(slot)
        setActiveSlotDate(slotDate)
        setSelectedSlot(slot)
        loadedDatesRef.current = new Set()
        setDailyData({})
      }
    }, 60000)
    return () => clearInterval(id)
  }, [settings, activeSlotDate])

  // Auth handlers
  function handleSignIn(newToken: string, user: string) {
    localStorage.setItem('task_token', newToken)
    setToken(newToken)
    setUsername(user)
    setShowSignIn(false)
  }

  function handleSignOut() {
    localStorage.removeItem('task_token')
    setToken(null)
    setUsername(null)
    const s = storage.getSettings()
    setSettings(s)
    const { slot, slotDate } = getActiveSlotDate(s.rotateHour, s.rotateMinute, s.workWeek ?? 'mon-fri')
    setActiveSlot(slot)
    setActiveSlotDate(slotDate)
    setSelectedSlot(slot)
    setTemplates(storage.getTemplates())
    loadedDatesRef.current = new Set()
    setDailyData({})
  }

  // Settings handlers
  async function handleSaveSettings(partial: Partial<Settings>) {
    const next = { ...settings, ...partial }
    setSettings(next)
    if (isAuth) {
      await api.settings.update(partial).catch(console.error)
    } else {
      storage.setSettings(next)
    }
    const { slot, slotDate } = getActiveSlotDate(next.rotateHour, next.rotateMinute, next.workWeek)
    if (slotDate !== activeSlotDate) {
      setActiveSlot(slot)
      setActiveSlotDate(slotDate)
      setSelectedSlot(slot)
      loadedDatesRef.current = new Set()
      setDailyData({})
    }
  }

  // Todo handlers
  async function handleAddTodo(text: string, dueDate?: string) {
    const todo = await api.todos.create(text, dueDate).catch(() => null)
    if (todo) setTodos(prev => [todo, ...prev])
  }

  async function handleToggleTodo(id: string) {
    const todo = todos.find(t => t.id === id)
    if (!todo) return
    const updated = await api.todos.update(id, { completed: !todo.completed }).catch(() => null)
    if (updated) setTodos(prev => prev.map(t => t.id === id ? updated : t))
  }

  async function handleEditTodo(id: string, text: string, due_date: string | null) {
    const updated = await api.todos.update(id, { text, due_date }).catch(() => null)
    if (updated) setTodos(prev => prev.map(t => t.id === id ? updated : t))
  }

  async function handleDeleteTodo(id: string) {
    await api.todos.remove(id).catch(console.error)
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  async function handleSubmitAgentTask(title: string, prompt: string): Promise<void> {
    const result = await api.agentq.submit(title, prompt)
    await loadAgentTasks()
    return void result
  }

  // Template handlers
  async function handleAddTemplate(text: string, slots: Slot[]) {
    for (const slot of slots) {
      if (isAuth) {
        const tempId = `temp-${crypto.randomUUID()}`
        const tempTemplate: Template = { id: tempId, slot, text, position: templates[slot].length, created_at: Date.now() }
        setTemplates(prev => ({ ...prev, [slot]: [...prev[slot], tempTemplate] }))
        try {
          const t = await api.templates.create(slot, text)
          setTemplates(prev => ({
            ...prev,
            [slot]: prev[slot].map(item => item.id === tempId ? t : item),
          }))
        } catch {
          setTemplates(prev => ({ ...prev, [slot]: prev[slot].filter(item => item.id !== tempId) }))
        }
      } else {
        setTemplates(prev => {
          const t: Template = { id: crypto.randomUUID(), slot, text, position: prev[slot].length, created_at: Date.now() }
          const next = { ...prev, [slot]: [...prev[slot], t] }
          storage.setTemplates(next)
          return next
        })
      }
    }
  }

  async function handleDeleteTemplate(id: string) {
    const slot = selectedSlot
    if (isAuth) {
      await api.templates.remove(id)
    }
    setTemplates(prev => {
      const next = { ...prev, [slot]: prev[slot].filter(t => t.id !== id) }
      if (!isAuth) storage.setTemplates(next)
      return next
    })
    if (activeSlotDate) {
      setDailyData(prev => {
        const active = prev[activeSlotDate]
        if (!active) return prev
        return {
          ...prev,
          [activeSlotDate]: { ...active, completions: active.completions.filter(c => c !== id) },
        }
      })
    }
  }

  async function handleEditTemplate(id: string, text: string) {
    const slot = selectedSlot
    if (isAuth) {
      const original = templates[slot].find(t => t.id === id)?.text ?? ''
      setTemplates(prev => ({
        ...prev,
        [slot]: prev[slot].map(t => t.id === id ? { ...t, text } : t),
      }))
      try {
        const t = await api.templates.update(id, text)
        setTemplates(prev => ({
          ...prev,
          [slot]: prev[slot].map(item => item.id === id ? t : item),
        }))
      } catch {
        setTemplates(prev => ({
          ...prev,
          [slot]: prev[slot].map(t => t.id === id ? { ...t, text: original } : t),
        }))
      }
    } else {
      setTemplates(prev => {
        const next = { ...prev, [slot]: prev[slot].map(t => t.id === id ? { ...t, text } : t) }
        storage.setTemplates(next)
        return next
      })
    }
  }

  async function handleMoveTemplate(id: string, dir: -1 | 1) {
    const slot = selectedSlot
    const list = [...templates[slot]]
    const idx = list.findIndex(t => t.id === id)
    if (idx < 0) return
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= list.length) return
    ;[list[idx], list[swapIdx]] = [list[swapIdx], list[idx]]
    const reordered = list.map((t, i) => ({ ...t, position: i }))
    setTemplates(prev => {
      const next = { ...prev, [slot]: reordered }
      if (!isAuth) storage.setTemplates(next)
      return next
    })
    if (isAuth) {
      await api.templates.reorder(slot, reordered.map(t => t.id)).catch(console.error)
    }
  }

  // Daily handlers
  async function handleToggleTemplate(id: string) {
    const slotDate = activeSlotDate
    const current = dailyData[slotDate]?.completions ?? []
    const done = current.includes(id)
    const next = done ? current.filter(c => c !== id) : [...current, id]
    setDailyData(prev => ({
      ...prev,
      [slotDate]: { ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }), completions: next },
    }))
    if (isAuth) {
      await api.daily.toggleTemplate(id, slotDate, !done).catch(console.error)
    } else {
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, completions: next })
    }
  }

  // Bonus task handlers
  async function handleAddAddition(text: string) {
    const slotDate = selectedSlotDate
    if (isAuth) {
      const tempId = `temp-${crypto.randomUUID()}`
      const tempAddition: Addition = { id: tempId, slot_date: slotDate, text, completed: false, created_at: Date.now() }
      setDailyData(prev => ({
        ...prev,
        [slotDate]: {
          ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
          additions: [...(prev[slotDate]?.additions ?? []), tempAddition],
        },
      }))
      try {
        const a = await api.daily.addAddition(slotDate, text)
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
            additions: (prev[slotDate]?.additions ?? []).map(item => item.id === tempId ? a : item),
          },
        }))
      } catch {
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
            additions: (prev[slotDate]?.additions ?? []).filter(item => item.id !== tempId),
          },
        }))
      }
    } else {
      const a: Addition = { id: crypto.randomUUID(), slot_date: slotDate, text, completed: false, created_at: Date.now() }
      setDailyData(prev => ({
        ...prev,
        [slotDate]: {
          ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
          additions: [...(prev[slotDate]?.additions ?? []), a],
        },
      }))
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, additions: [...d.additions, a] })
    }
  }

  async function handleDeleteAddition(id: string) {
    const slotDate = selectedSlotDate
    if (isAuth) {
      await api.daily.removeAddition(id)
    }
    setDailyData(prev => ({
      ...prev,
      [slotDate]: {
        ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
        additions: (prev[slotDate]?.additions ?? []).filter(a => a.id !== id),
      },
    }))
    if (!isAuth) {
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, additions: d.additions.filter(a => a.id !== id) })
    }
  }

  async function handleEditAddition(id: string, text: string) {
    const slotDate = selectedSlotDate
    if (isAuth) {
      const original = dailyData[slotDate]?.additions.find(a => a.id === id)?.text ?? ''
      setDailyData(prev => ({
        ...prev,
        [slotDate]: {
          ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
          additions: (prev[slotDate]?.additions ?? []).map(a => a.id === id ? { ...a, text } : a),
        },
      }))
      try {
        const a = await api.daily.updateAddition(id, text)
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
            additions: (prev[slotDate]?.additions ?? []).map(item => item.id === id ? a : item),
          },
        }))
      } catch {
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
            additions: (prev[slotDate]?.additions ?? []).map(a => a.id === id ? { ...a, text: original } : a),
          },
        }))
      }
    } else {
      setDailyData(prev => ({
        ...prev,
        [slotDate]: {
          ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
          additions: (prev[slotDate]?.additions ?? []).map(a => a.id === id ? { ...a, text } : a),
        },
      }))
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, additions: d.additions.map(a => a.id === id ? { ...a, text } : a) })
    }
  }

  async function handleToggleAddition(id: string) {
    const slotDate = selectedSlotDate
    const additions = dailyData[slotDate]?.additions ?? []
    const a = additions.find(x => x.id === id)
    if (!a) return
    setDailyData(prev => ({
      ...prev,
      [slotDate]: {
        ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }),
        additions: (prev[slotDate]?.additions ?? []).map(x =>
          x.id === id ? { ...x, completed: !x.completed } : x
        ),
      },
    }))
    if (isAuth) {
      await api.daily.toggleAddition(id, !a.completed).catch(console.error)
    } else {
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, {
        ...d,
        additions: d.additions.map(x => x.id === id ? { ...x, completed: !x.completed } : x),
      })
    }
  }

  // Event handlers
  async function handleAddEvent(data: { title: string; start_date: string; end_date: string; time?: string; recurrence?: Recurrence }) {
    if (isAuth) {
      const event = await api.events.create(data)
      setCalendarEvents(prev => [...prev, event])
    } else {
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        title: data.title,
        start_date: data.start_date,
        end_date: data.end_date,
        time: data.time || null,
        recurrence: data.recurrence || null,
        created_at: Date.now(),
      }
      const next = [...storage.getEvents(), event]
      storage.setEvents(next)
      setCalendarEvents(next)
    }
  }

  async function handleEditEvent(id: string, data: { title: string; start_date: string; end_date: string; time?: string; recurrence?: Recurrence }) {
    if (isAuth) {
      const event = await api.events.update(id, data)
      setCalendarEvents(prev => prev.map(e => e.id === id ? event : e))
    } else {
      setCalendarEvents(prev => {
        const next = prev.map(e => e.id === id
          ? { ...e, title: data.title, start_date: data.start_date, end_date: data.end_date, time: data.time || null, recurrence: data.recurrence || null }
          : e)
        storage.setEvents(next)
        return next
      })
    }
  }

  async function handleDeleteEvent(id: string) {
    if (isAuth) {
      await api.events.remove(id)
    } else {
      const next = storage.getEvents().filter(e => e.id !== id)
      storage.setEvents(next)
    }
    setCalendarEvents(prev => prev.filter(e => e.id !== id))
  }

  async function handleToggleEvent(eventId: string) {
    const slotDate = selectedSlotDate
    const current = dailyData[slotDate]?.eventCompletions ?? []
    const done = current.includes(eventId)
    const next = done ? current.filter(id => id !== eventId) : [...current, eventId]
    setDailyData(prev => ({
      ...prev,
      [slotDate]: { ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }), eventCompletions: next },
    }))
    if (isAuth) {
      await api.events.toggle(eventId, slotDate, !done).catch(console.error)
    } else {
      storage.toggleEventCompletion(eventId, slotDate, !done)
    }
  }

  // Export / Import
  async function handleExport() {
    if (isAuth) {
      const data = await api.export()
      downloadExport(data)
    } else {
      downloadExport(storage.export())
    }
  }

  async function handleImport(data: ExportData, mode: 'merge' | 'replace') {
    if (isAuth) {
      await api.import(data, mode)
      const t = await api.templates.getAll()
      setTemplates(t)
    } else {
      storage.import(data, mode)
      setTemplates(storage.getTemplates())
    }
  }

  // Build templates with completion state for selected slot
  const selectedTemplates: TemplateWithState[] = (templates[selectedSlot] ?? []).map(t => ({
    ...t,
    completed: selectedDailyData.completions.includes(t.id),
  }))

  const boardDone = selectedTemplates.filter(t => t.completed).length
    + selectedDailyData.additions.filter(a => a.completed).length
    + selectedEvents.filter(e => e.completed).length
  const boardTotal = selectedTemplates.length
    + selectedDailyData.additions.length
    + selectedEvents.length

  return (
    <div className="app">
      {/* Left rail navigation */}
      <nav className="app-rail">
        <a href="https://kevinprk.com" className="rail-pi-mark" title="kevinprk.com">π</a>

        <button
          className={`rail-btn${view === 'routine' ? ' rail-btn-active' : ''}`}
          onClick={() => setView('routine')} title="Routine"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
        </button>
        <button
          className={`rail-btn${view === 'task' ? ' rail-btn-active' : ''}`}
          onClick={() => setView('task')} title="Task"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </button>
        <button
          className={`rail-btn${view === 'calendar' ? ' rail-btn-active' : ''}`}
          onClick={() => setView('calendar')} title="Calendar"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
        </button>
        <button
          className={`rail-btn${view === 'mail' ? ' rail-btn-active' : ''}`}
          onClick={() => setView('mail')} title="Mail"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
          {mailUnread > 0 && (
            <span className="rail-badge">{mailUnread > 99 ? '99+' : mailUnread}</span>
          )}
        </button>
        <button
          className={`rail-btn${view === 'news' ? ' rail-btn-active' : ''}`}
          onClick={() => setView('news')} title="News"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
          </svg>
        </button>

        <div className="rail-spacer" />

        <button className="rail-btn" onClick={() => setShowSettings(true)} title="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
        <button
          className="rail-btn"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
          </svg>
        </button>
      </nav>

      <main className="app-main">
        {view === 'routine' ? (
          <>
            {/* Date hero */}
            <div className="board-date-hero">
              <span className="board-day-name">{SLOT_DAY_NAMES[selectedSlot] ?? selectedSlot}</span>
              <span className="board-date-mono">{selectedSlotDate}</span>
              <div className="rail-spacer" />
              {boardTotal > 0 && (
                <span className="board-progress-count">
                  <span className="board-progress-done">{boardDone}</span>/{boardTotal}
                </span>
              )}
              {boardTotal > 0 && (
                <div className="board-progress-bar">
                  <div className="board-progress-fill" style={{ width: `${boardDone / boardTotal * 100}%` }} />
                </div>
              )}
            </div>

            {/* Day chips */}
            <div className="board-chips-bar">
              <DayTabs
                selected={selectedSlot}
                active={activeSlot}
                onChange={setSelectedSlot}
                slotLabels={getSlotLabels(settings.workWeek)}
                slotOrder={getSlotOrder(settings.workWeek)}
              />
              <button
                className="icon-btn"
                onClick={syncBoardData}
                disabled={boardSyncing}
                aria-label="Sync"
                title="Sync"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  style={{ animation: boardSyncing ? 'mail-spin 1s linear infinite' : undefined }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>

            {/* Board content */}
            <div className="board-content">
              <RoutineBoard
                slot={selectedSlot}
                slotDate={selectedSlotDate}
                isActive={selectedSlot === activeSlot}
                templates={selectedTemplates}
                additions={selectedDailyData.additions}
                calendarEvents={selectedEvents}
                rotateHour={settings.rotateHour}
                rotateMinute={settings.rotateMinute}
                slotLabels={getSlotLabels(settings.workWeek)}
                onToggleTemplate={handleToggleTemplate}
                onAddTemplate={handleAddTemplate}
                onDeleteTemplate={handleDeleteTemplate}
                onMoveTemplate={handleMoveTemplate}
                onAddAddition={handleAddAddition}
                onDeleteAddition={handleDeleteAddition}
                onEditAddition={handleEditAddition}
                onToggleAddition={handleToggleAddition}
                onEditTemplate={handleEditTemplate}
                onToggleEvent={handleToggleEvent}
                dueTodos={dueTodos}
                onToggleTodo={handleToggleTodo}
              />
            </div>
            <div className="board-footer">
              <span className="board-footer-label">π  kevinprk.com</span>
            </div>
          </>
        ) : view === 'calendar' ? (
          <CalendarView
            year={calendarMonth.year}
            month={calendarMonth.month}
            events={monthEvents}
            additions={monthAdditions}
            selectedDate={selectedCalendarDate}
            onPrevMonth={() => setCalendarMonth(prev => {
              const m = prev.month === 1 ? 12 : prev.month - 1
              const y = prev.month === 1 ? prev.year - 1 : prev.year
              return { year: y, month: m }
            })}
            onNextMonth={() => setCalendarMonth(prev => {
              const m = prev.month === 12 ? 1 : prev.month + 1
              const y = prev.month === 12 ? prev.year + 1 : prev.year
              return { year: y, month: m }
            })}
            todosByDate={todosByDate}
            onDayClick={date => { setSelectedCalendarDate(prev => prev === date ? null : date); setEditingEventId(null) }}
            onEventClick={event => { setSelectedCalendarDate(event.start_date); setEditingEventId(event.id) }}
          />
        ) : view === 'mail' ? (
          <MailInbox isAuth={isAuth} isDark={theme === 'dark'} onUnreadCount={setMailUnread} />
        ) : view === 'news' ? (
          <NewsView />
        ) : (
          <TaskView
            todos={todos}
            onAddTodo={handleAddTodo}
            onToggleTodo={handleToggleTodo}
            onEditTodo={handleEditTodo}
            onDeleteTodo={handleDeleteTodo}
            agentTasks={agentTasks}
            onSubmitAgentTask={handleSubmitAgentTask}
          />
        )}
      </main>

      {view === 'calendar' && selectedCalendarDate && (
        <EventPanel
          date={selectedCalendarDate}
          dayEvents={selectedDayEvents}
          dayTodos={calendarDayTodos}
          focusEventId={editingEventId}
          onClose={() => { setSelectedCalendarDate(null); setEditingEventId(null) }}
          onAdd={handleAddEvent}
          onEdit={handleEditEvent}
          onDelete={handleDeleteEvent}
          onToggleTodo={handleToggleTodo}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          username={username}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
          onSignIn={() => { setShowSettings(false); setShowSignIn(true) }}
          onSignOut={handleSignOut}
          onExport={handleExport}
          onImport={() => { setShowSettings(false); setShowImport(true) }}
        />
      )}

      {showSignIn && (
        <SignInModal
          onClose={() => setShowSignIn(false)}
          onSuccess={handleSignIn}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}

      {/* Bottom tab bar — mobile only */}
      <nav className="app-bottom-nav">
        <button className={`bottom-nav-btn${view === 'routine' ? ' bottom-nav-active' : ''}`} onClick={() => setView('routine')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
          <span>Routine</span>
        </button>
        <button className={`bottom-nav-btn${view === 'task' ? ' bottom-nav-active' : ''}`} onClick={() => setView('task')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span>Task</span>
        </button>
        <button className={`bottom-nav-btn${view === 'calendar' ? ' bottom-nav-active' : ''}`} onClick={() => setView('calendar')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          <span>Calendar</span>
        </button>
        <button className={`bottom-nav-btn${view === 'mail' ? ' bottom-nav-active' : ''}`} onClick={() => setView('mail')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
          {mailUnread > 0 && <span className="bottom-nav-badge">{mailUnread > 99 ? '99+' : mailUnread}</span>}
          <span>Mail</span>
        </button>
        <button className={`bottom-nav-btn${view === 'news' ? ' bottom-nav-active' : ''}`} onClick={() => setView('news')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
          </svg>
          <span>News</span>
        </button>
        <button className="bottom-nav-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
          </svg>
          <span>Theme</span>
        </button>
      </nav>
    </div>
  )
}
