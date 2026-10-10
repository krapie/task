import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { DayTabs } from './components/DayTabs'
import { RoutineBoard } from './components/RoutineBoard'
import { SettingsPanel, downloadExport } from './components/SettingsPanel'
import { ImportModal } from './components/ImportModal'
import { CalendarView } from './components/CalendarView'
import { EventPanel } from './components/EventPanel'
import { MailInbox } from './components/MailInbox'
import { NewsView } from './components/NewsView'
import { SignInRequired } from './components/SignInRequired'
import { GoalView } from './components/GoalView'
import AssetsView from './components/AssetsView'
import HealthView from './components/HealthView'
import { Icon } from './components/Icons'
import { ResetCountdown } from './components/ResetCountdown'
import { DialogHost, LoadingBar, ToastHost } from './components/Ui'
import { AUTH_ONLY_VIEWS, GROUPS, OWNER_ONLY_VIEWS, VIEW_ICONS, VIEW_LABELS, groupOf, hashOf, isViewVisible, parseLocation, type RoutineTab, type View, type YearMonth } from './lib/nav'
import { storage } from './lib/storage'
import { expandForView, expandForDate, calendarViewRange } from './lib/recurrence'
import { api } from './lib/api'
import { getActiveSlotDate, getNextSlotDate, getSlotLabels, getSlotOrder, getSlotDateForCalendarDate } from './lib/slots'
import type { Slot, Template, TemplateWithState, Addition, Settings, ExportData, DailyData, CalendarEvent, DailyEvent, Recurrence, TodoItem } from './types'
import { notify, notifyError } from './lib/notify'

type Theme = 'light' | 'dark'
const OWNER_USERNAME = 'kevinprk'

const SLOT_DAY_NAMES: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', weekend: 'Weekend',
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
  skips?: string[]
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

  // Set once the auth.kevinprk.com session resolves (see api.auth.session).
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const isAuth = token !== null
  const isOwner = isAuth && username === OWNER_USERNAME

  const [settings, setSettings] = useState<Settings>({ rotateHour: 6, rotateMinute: 0, keepBonus: false, workWeek: 'mon-fri' })

  const [activeSlot, setActiveSlot] = useState<Slot>('mon')
  const [activeSlotDate, setActiveSlotDate] = useState<string>('')

  const [templates, setTemplates] = useState<Record<Slot, Template[]>>({
    mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [],
  })

  const [dailyData, setDailyData] = useState<Record<string, SlotDailyData>>({})
  const loadedDatesRef = useRef<Set<string>>(new Set())

  const [selectedSlot, setSelectedSlot] = useState<Slot>('mon')
  const [showImport, setShowImport] = useState(false)

  // Initial position comes from the hash, or the legacy ?tab=&mail= links in push notifications.
  const initialRoute = useRef(parseLocation()).current
  const [routineTab, setRoutineTab] = useState<RoutineTab>(initialRoute.tab)
  const [view, setView] = useState<View>(initialRoute.view)
  // Deep-link: ?mail=<id> opens a specific email (set by push notification URL)
  const [initialMailId] = useState<string | null>(initialRoute.mailId)
  const [calendarMonth, setCalendarMonth] = useState<YearMonth>(() => {
    if (initialRoute.month) return initialRoute.month
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })

  // State -> URL: every navigation is a history entry (the first one replaces, so Back leaves the app).
  const hashSynced = useRef(false)
  useEffect(() => {
    const h = hashOf(view, routineTab, calendarMonth)
    if (location.hash === h && !location.search) { hashSynced.current = true; return }
    const url = location.pathname + h
    if (hashSynced.current) history.pushState(null, '', url)
    else history.replaceState(null, '', url)
    hashSynced.current = true
  }, [view, routineTab, calendarMonth])

  // URL -> state: Back/Forward and hand-edited hashes.
  useEffect(() => {
    const onNav = () => {
      const r = parseLocation()
      setView(r.view)
      setRoutineTab(r.tab)
      const m = r.month
      if (m) setCalendarMonth(prev => (prev.year === m.year && prev.month === m.month ? prev : m))
    }
    window.addEventListener('popstate', onNav)
    window.addEventListener('hashchange', onNav)
    return () => {
      window.removeEventListener('popstate', onNav)
      window.removeEventListener('hashchange', onNav)
    }
  }, [])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarAdditions, setCalendarAdditions] = useState<Addition[]>([])
  const [todos, setTodos] = useState<TodoItem[]>([])
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


  // Derived: todos due on the selected calendar date (for EventPanel)
  const calendarDayTodos = useMemo(() =>
    selectedCalendarDate ? todos.filter(t => t.due_date === selectedCalendarDate) : [],
    [todos, selectedCalendarDate]
  )

  // Derived: bonus task additions for the selected calendar date (for EventPanel)
  const calendarDayAdditions = useMemo(() => {
    if (!selectedCalendarDate) return []
    const slotDate = getSlotDateForCalendarDate(selectedCalendarDate, settings.workWeek)
    return calendarAdditions.filter(a => a.slot_date === slotDate)
  }, [calendarAdditions, selectedCalendarDate, settings.workWeek])

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

  // Resolve the central SSO session on mount; without one Task stays in local mode.
  useEffect(() => {
    api.auth.session().then(s => {
      if (!s) return
      setToken(s.username)
      setUsername(s.username)
    })
  }, [])

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

  const loadDaily = useCallback(async (slotDate: string) => {
    if (!slotDate || loadedDatesRef.current.has(slotDate)) return
    loadedDatesRef.current.add(slotDate)
    if (isAuth) {
      const d = await api.daily.get(slotDate).catch(() => null) as DailyData | null
      if (!d) return
      const serverCompletions = d.completionIds ?? d.templates.filter(t => t.completed).map(t => t.id)
      const serverAdditions = d.additions
      const serverEventCompletions = d.eventCompletions ?? []
      const serverSkips = d.skipIds ?? []
      setDailyData(prev => {
        const existing = prev[slotDate]
        if (!existing) {
          return { ...prev, [slotDate]: { completions: serverCompletions, additions: serverAdditions, eventCompletions: serverEventCompletions, skips: serverSkips } }
        }
        const serverIds = new Set(serverAdditions.map(a => a.id))
        const localOnly = existing.additions.filter(a => !serverIds.has(a.id) && !a.id.startsWith('temp-'))
        return {
          ...prev,
          [slotDate]: {
            completions: serverCompletions,
            additions: [...serverAdditions, ...localOnly],
            eventCompletions: serverEventCompletions,
            skips: serverSkips,
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
    })
  }, [isAuth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load daily data whenever the selected slot changes or the Tasks board is
  // opened. The cache entry is dropped first so a day chip always shows
  // completions made on another device (e.g. the iPhone app).
  useEffect(() => {
    if (!activeSlotDate || view !== 'routine' || routineTab !== 'tasks') return
    const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate, settings.workWeek)
    loadedDatesRef.current.delete(slotDate)
    loadDaily(slotDate)
  }, [selectedSlot, activeSlot, activeSlotDate, view, routineTab, loadDaily]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload events and additions when switching to or navigating within calendar view
  useEffect(() => {
    if (view === 'calendar') {
      loadAllEvents()
      loadCalendarAdditions(calendarMonth.year, calendarMonth.month)
    }
  }, [view, calendarMonth]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Refresh all data when the browser tab/window becomes visible again or
  // regains focus. On desktop, switching apps leaves the window visible, so
  // visibilitychange alone misses it; focus covers that case. Both can fire
  // together, so refreshes within 2s of each other are collapsed.
  const lastFocusRefreshRef = useRef(0)
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible' || !activeSlotDate) return
      const now = Date.now()
      if (now - lastFocusRefreshRef.current < 2000) return
      lastFocusRefreshRef.current = now
      const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate, settings.workWeek)
      loadedDatesRef.current.delete(slotDate)
      loadTemplates()
      loadAllEvents()
      loadDaily(slotDate)
      loadTodos()
      if (view === 'calendar') {
        loadCalendarAdditions(calendarMonth.year, calendarMonth.month)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onVisibilityChange)
    }
  }, [selectedSlot, activeSlot, activeSlotDate, view, calendarMonth, loadTemplates, loadAllEvents, loadDaily, loadTodos, loadCalendarAdditions])

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
      loadTodos()
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [isAuth, activeSlotDate, selectedSlot, activeSlot, loadTemplates, loadAllEvents, loadDaily, loadTodos])

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
  function handleSignOut() {
    api.auth.signOut()
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
    if (AUTH_ONLY_VIEWS.includes(view)) setView('routine')
    setRoutineTab('tasks')
  }

  // Settings handlers
  async function handleSaveSettings(partial: Partial<Settings>) {
    const next = { ...settings, ...partial }
    setSettings(next)
    storage.setSettings(next)
    if (isAuth) {
      // Always send the browser timezone so the server can fire notifications at the right local time
      const payload = { ...partial, taskNotifyTz: Intl.DateTimeFormat().resolvedOptions().timeZone }
      await api.settings.update(payload).catch(notifyError)
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
    const gone = todos.find(t => t.id === id)
    await api.todos.remove(id).catch(notifyError)
    setTodos(prev => prev.filter(t => t.id !== id))
    if (gone) notify(`Deleted "${gone.text}"`, 'info', 6000, { label: 'Undo', run: () => { void latest.current.addTodo(gone.text, gone.due_date ?? undefined) } })
  }

  // Template handlers
  async function handleAddTemplate(text: string, slots: Slot[]) {
    for (const slot of slots) {
      if (isAuth) {
        const tempId = `temp-${crypto.randomUUID()}`
        const tempTemplate: Template = { id: tempId, slot, text, position: templates[slot].length, group_id: null, created_at: Date.now() }
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
          const t: Template = { id: crypto.randomUUID(), slot, text, position: prev[slot].length, group_id: null, created_at: Date.now() }
          const next = { ...prev, [slot]: [...prev[slot], t] }
          storage.setTemplates(next)
          return next
        })
      }
    }
  }

  async function handleDeleteTemplate(id: string) {
    const slot = selectedSlot
    const gone = templates[slot]?.find(t => t.id === id)
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
    if (gone) notify(`Deleted "${gone.text}"`, 'info', 6000, { label: 'Undo', run: () => { void latest.current.addTemplate(gone.text, [slot]) } })
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
      await api.templates.reorder(slot, reordered.map(t => t.id)).catch(notifyError)
    }
  }

  // Daily handlers
  async function handleToggleTemplate(id: string) {
    const slotDate = activeSlotDate
    const current = dailyData[slotDate]?.completions ?? []
    const done = current.includes(id)
    // Optimistically include OR-group members when marking complete
    const tmpl = templates[activeSlot]?.find(t => t.id === id)
    const groupMemberIds = !done && tmpl?.group_id
      ? (templates[activeSlot] ?? []).filter(t => t.group_id === tmpl.group_id && t.id !== id).map(t => t.id)
      : []
    const next = done
      ? current.filter(c => c !== id)
      : [...new Set([...current, id, ...groupMemberIds])]
    setDailyData(prev => ({
      ...prev,
      [slotDate]: { ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }), completions: next },
    }))
    if (isAuth) {
      await api.daily.toggleTemplate(id, slotDate, !done).catch(notifyError)
    } else {
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, completions: next })
    }
  }

  // Hide/unhide a routine for the active day only; it reappears after the next rotation
  async function handleSkipTemplate(id: string) {
    const slotDate = activeSlotDate
    const current = dailyData[slotDate]?.skips ?? []
    const skipped = current.includes(id)
    const text = templates[selectedSlot]?.find(t => t.id === id)?.text
    const next = skipped ? current.filter(s => s !== id) : [...current, id]
    setDailyData(prev => ({
      ...prev,
      [slotDate]: { ...(prev[slotDate] ?? { completions: [], additions: [], eventCompletions: [] }), skips: next },
    }))
    if (isAuth) {
      await api.daily.skipTemplate(id, slotDate, !skipped).catch(notifyError)
    } else {
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, skips: next })
    }
    if (!skipped && text) notify(`Hidden for today: "${text}"`, 'info', 6000, { label: 'Undo', run: () => { void latest.current.skipTemplate(id) } })
  }

  async function handleLinkTemplate(id: string, targetId: string) {
    const updated = await api.templates.link(id, targetId).catch(() => null)
    if (!updated) return
    setTemplates(prev => {
      const result = { ...prev } as Record<Slot, Template[]>
      for (const slot of Object.keys(result) as Slot[]) {
        result[slot] = result[slot].map(t => {
          const u = updated.find(r => r.id === t.id)
          return u ? { ...t, group_id: u.group_id } : t
        })
      }
      return result
    })
  }

  async function handleUnlinkTemplate(id: string) {
    await api.templates.unlink(id).catch(notifyError)
    setTemplates(prev => {
      const result = { ...prev } as Record<Slot, Template[]>
      for (const slot of Object.keys(result) as Slot[]) {
        result[slot] = result[slot].map(t => t.id === id ? { ...t, group_id: null } : t)
      }
      return result
    })
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

  async function handleAddAdditionForDate(calendarDate: string, text: string) {
    const slotDate = getSlotDateForCalendarDate(calendarDate, settings.workWeek)
    const tempId = `temp-${crypto.randomUUID()}`
    const tempAddition: Addition = { id: tempId, slot_date: slotDate, text, completed: false, created_at: Date.now() }
    setCalendarAdditions(prev => [...prev, tempAddition])
    if (isAuth) {
      try {
        const a = await api.daily.addAddition(slotDate, text)
        setCalendarAdditions(prev => prev.map(item => item.id === tempId ? a : item))
      } catch {
        setCalendarAdditions(prev => prev.filter(item => item.id !== tempId))
      }
    } else {
      const a: Addition = { id: crypto.randomUUID(), slot_date: slotDate, text, completed: false, created_at: Date.now() }
      setCalendarAdditions(prev => prev.map(item => item.id === tempId ? a : item))
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, additions: [...d.additions, a] })
    }
  }

  // Calendar-scoped variants — operate on `calendarAdditions` rather than the routine `dailyData`
  async function handleDeleteAdditionForDate(id: string) {
    const target = calendarAdditions.find(a => a.id === id)
    if (!target) return
    setCalendarAdditions(prev => prev.filter(a => a.id !== id))
    if (isAuth) {
      if (!id.startsWith('temp-')) {
        try {
          await api.daily.removeAddition(id)
        } catch {
          setCalendarAdditions(prev => [...prev, target])
        }
      }
    } else {
      const d = storage.getDaily(target.slot_date)
      storage.setDaily(target.slot_date, { ...d, additions: d.additions.filter(a => a.id !== id) })
    }
  }

  async function handleToggleAdditionForDate(id: string) {
    const target = calendarAdditions.find(a => a.id === id)
    if (!target) return
    setCalendarAdditions(prev => prev.map(a => a.id === id ? { ...a, completed: !a.completed } : a))
    if (isAuth) {
      if (!id.startsWith('temp-')) {
        await api.daily.toggleAddition(id, !target.completed).catch(notifyError)
      }
    } else {
      const d = storage.getDaily(target.slot_date)
      storage.setDaily(target.slot_date, {
        ...d,
        additions: d.additions.map(a => a.id === id ? { ...a, completed: !a.completed } : a),
      })
    }
  }

  async function handleDeleteAddition(id: string) {
    const slotDate = selectedSlotDate
    const gone = dailyData[slotDate]?.additions.find(a => a.id === id)
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
    if (gone) notify(`Deleted "${gone.text}"`, 'info', 6000, { label: 'Undo', run: () => { void latest.current.addAddition(gone.text) } })
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
      await api.daily.toggleAddition(id, !a.completed).catch(notifyError)
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
      await api.events.toggle(eventId, slotDate, !done).catch(notifyError)
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
    skipped: selectedDailyData.skips?.includes(t.id) ?? false,
  }))
  const visibleTemplates = selectedTemplates.filter(t => !t.skipped)

  const boardDone = visibleTemplates.filter(t => t.completed).length
    + selectedDailyData.additions.filter(a => a.completed).length
    + selectedEvents.filter(e => e.completed).length
  const boardTotal = visibleTemplates.length
    + selectedDailyData.additions.length
    + selectedEvents.length

  const visibleGroups = GROUPS
    .map(g => {
      const visible = g.views.filter(v => isViewVisible(v, isAuth, isOwner))
      // A group with a single reachable view (e.g. News for guests) is named after it.
      const solo = visible.length === 1 && g.views.length > 1 ? visible[0] : null
      return { ...g, visible, label: solo ? VIEW_LABELS[solo] : g.label, icon: solo ? VIEW_ICONS[solo] : g.icon }
    })
    .filter(g => g.visible.length > 0)
  const currentGroup = visibleGroups.find(g => g.id === groupOf(view).id)
  const subViews = currentGroup && currentGroup.id !== 'today' ? currentGroup.visible : []
  const goGroup = (g: (typeof visibleGroups)[number]) => { if (groupOf(view).id !== g.id) setView(g.visible[0]) }
  const groupBadge = (id: string) => (id === 'inbox' ? mailUnread : 0)

  // Undo toasts outlive the render that created them; they call the newest handlers through this ref.
  const latest = useRef({ addTodo: handleAddTodo, addTemplate: handleAddTemplate, addAddition: handleAddAddition, skipTemplate: handleSkipTemplate })
  latest.current = { addTodo: handleAddTodo, addTemplate: handleAddTemplate, addAddition: handleAddAddition, skipTemplate: handleSkipTemplate }

  const shiftMonth = (delta: number) => setCalendarMonth(prev => {
    const d = new Date(prev.year, prev.month - 1 + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })

  // Keyboard shortcuts (desktop): g t/c/i/l/s go to a section, n new task, / search mail, [ ] month, ? help.
  const keys = useRef({ view, goGroup: (_id: string) => {}, shiftMonth })
  keys.current = { view, shiftMonth, goGroup: id => { const g = visibleGroups.find(x => x.id === id); if (g) goGroup(g) } }
  useEffect(() => {
    let gAt = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      if (document.querySelector('.modal-overlay')) return
      const k = e.key
      if (gAt && Date.now() - gAt < 1000) {
        gAt = 0
        const target = ({ t: 'today', c: 'calendar', i: 'inbox', l: 'life', s: 'settings' } as Record<string, string>)[k]
        if (target) { e.preventDefault(); keys.current.goGroup(target) }
        return
      }
      if (k === 'g') { gAt = Date.now(); return }
      if (k === 'n' && keys.current.view === 'routine') {
        const el = document.querySelector<HTMLInputElement>('.add-task-input')
        if (el) { e.preventDefault(); el.focus() }
      } else if (k === '/' && keys.current.view === 'mail') {
        const el = document.querySelector<HTMLInputElement>('.mail-search-input')
        if (el) { e.preventDefault(); el.focus() }
      } else if ((k === '[' || k === ']') && keys.current.view === 'calendar') {
        keys.current.shiftMonth(k === '[' ? -1 : 1)
      } else if (k === '?') {
        notify('g then t/c/i/l/s: go to Today/Calendar/Inbox/Life/Settings · n: new task · /: search mail · j/k/Enter/e/s: move, open, read, star in the inbox · [ ]: previous/next month', 'info', 10000)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <LoadingBar />
      {/* Left rail navigation */}
      <nav className="app-rail" aria-label="Views">
        <a href="https://kevinprk.com" className="rail-pi-mark" title="kevinprk.com">π</a>
        {visibleGroups.map(g => (
          <button
            key={g.id}
            className={`rail-btn${currentGroup?.id === g.id ? ' rail-btn-active' : ''}`}
            onClick={() => goGroup(g)}
            title={g.label}
            aria-label={g.label}
            aria-current={currentGroup?.id === g.id ? 'page' : undefined}
          >
            <Icon name={g.icon} />
            {groupBadge(g.id) > 0 && (
              <span className="rail-badge">{groupBadge(g.id) > 99 ? '99+' : groupBadge(g.id)}</span>
            )}
          </button>
        ))}
        <div className="rail-spacer" />
        <button className="rail-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle theme" aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </nav>

      {/* Phones: slim top bar with the π mark, current section and the theme toggle (desktop has the rail) */}
      <header className="app-topbar">
        <a href="https://kevinprk.com" className="rail-pi-mark" title="kevinprk.com" aria-label="kevinprk.com">π</a>
        <span className="app-topbar-title">{VIEW_LABELS[view]}</span>
        <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </header>

      <main className="app-main">
        {subViews.length > 1 && (
          <nav className="view-tabs" aria-label={`${currentGroup?.label} pages`}>
            {subViews.map(v => (
              <button key={v} className={`view-tab${view === v ? ' active' : ''}`} onClick={() => setView(v)} aria-current={view === v ? 'page' : undefined}>
                {VIEW_LABELS[v]}
                {v === 'mail' && mailUnread > 0 && <span className="view-tab-badge">{mailUnread > 99 ? '99+' : mailUnread}</span>}
              </button>
            ))}
          </nav>
        )}
        {view === 'routine' ? (
          <>
            {/* Date hero / Goals header */}
            <div className="board-date-hero">
              {routineTab === 'tasks' ? (
                <>
                  <span className="board-day-name">{SLOT_DAY_NAMES[selectedSlot] ?? selectedSlot}</span>
                  <span className={`board-day-tag${selectedSlot === activeSlot ? ' board-day-tag-today' : ''}`}>
                    {selectedSlot === activeSlot ? 'Today' : 'Upcoming'}
                  </span>
                  <span className="board-date-mono">{selectedSlotDate}</span>
                  {selectedSlot === activeSlot && <ResetCountdown rotateHour={settings.rotateHour} rotateMinute={settings.rotateMinute} />}
                </>
              ) : (
                <span className="board-day-name">Goals</span>
              )}
              <div className="rail-spacer" />
              {routineTab === 'tasks' && boardTotal > 0 && (
                <span className="board-progress-count">
                  {boardDone === boardTotal ? (
                    <span className="board-progress-done board-all-done"><Icon name="check" size={14} /> All done</span>
                  ) : (
                    <><span className="board-progress-done">{boardDone}</span>/{boardTotal}</>
                  )}
                </span>
              )}
              {routineTab === 'tasks' && boardTotal > 0 && (
                <div className="board-progress-bar">
                  <div className="board-progress-fill" style={{ width: `${boardDone / boardTotal * 100}%` }} />
                </div>
              )}
              {isAuth && <div className="view-tabs view-tabs-inline">
                <button
                  className={`view-tab${routineTab === 'tasks' ? ' active' : ''}`}
                  onClick={() => setRoutineTab('tasks')}
                >Tasks</button>
                <button
                  className={`view-tab${routineTab === 'goals' ? ' active' : ''}`}
                  onClick={() => setRoutineTab('goals')}
                >Goals</button>
              </div>}
            </div>

            {routineTab === 'tasks' ? (
              <>
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
                    <Icon name="refresh" size={16} style={{ animation: boardSyncing ? 'mail-spin 1s linear infinite' : undefined }} />
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
                    slotLabels={getSlotLabels(settings.workWeek)}
                    onToggleTemplate={handleToggleTemplate}
                    onSkipTemplate={handleSkipTemplate}
                    onAddTemplate={handleAddTemplate}
                    onDeleteTemplate={handleDeleteTemplate}
                    onMoveTemplate={handleMoveTemplate}
                    onAddAddition={handleAddAddition}
                    onDeleteAddition={handleDeleteAddition}
                    onEditAddition={handleEditAddition}
                    onToggleAddition={handleToggleAddition}
                    onEditTemplate={handleEditTemplate}
                    onToggleEvent={handleToggleEvent}
                    todos={todos}
                    onToggleTodo={handleToggleTodo}
                    onAddTodo={handleAddTodo}
                    onEditTodo={handleEditTodo}
                    onDeleteTodo={handleDeleteTodo}
                    onLinkTemplate={handleLinkTemplate}
                    onUnlinkTemplate={handleUnlinkTemplate}
                    isAuth={isAuth}
                  />
                </div>
                <div className="board-footer">
                  <span className="board-footer-label">π  kevinprk.com</span>
                </div>
              </>
            ) : (
              isAuth ? <GoalView isAuth={isAuth} /> : <SignInRequired feature="Goals" onSignIn={() => api.auth.signIn()} />
            )}
          </>
        ) : view === 'calendar' ? (
          <CalendarView
            year={calendarMonth.year}
            month={calendarMonth.month}
            events={monthEvents}
            additions={monthAdditions}
            selectedDate={selectedCalendarDate}
            onPrevMonth={() => shiftMonth(-1)}
            onNextMonth={() => shiftMonth(1)}
            todos={todos}
            onDayClick={date => { setSelectedCalendarDate(prev => prev === date ? null : date); setEditingEventId(null) }}
            onEventClick={event => { setSelectedCalendarDate(event.start_date); setEditingEventId(event.id) }}
          />
        ) : !isAuth && AUTH_ONLY_VIEWS.includes(view) ? (
          <SignInRequired feature={VIEW_LABELS[view]} onSignIn={() => api.auth.signIn()} />
        ) : view === 'mail' ? (
          <MailInbox isAuth={isAuth} isDark={theme === 'dark'} onUnreadCount={setMailUnread} initialMailId={initialMailId} />
        ) : view === 'news' ? (
          <NewsView isAuth={isAuth} />
        ) : OWNER_ONLY_VIEWS.includes(view) && !isOwner ? (
          <div className="signin-required">
            <p className="signin-required-title">{VIEW_LABELS[view]} isn't available for this account</p>
          </div>
        ) : view === 'assets' ? (
          <AssetsView isAuth={isAuth} />
        ) : view === 'health' ? (
          <HealthView isAuth={isAuth} />
        ) : (
          <SettingsPanel
            settings={settings}
            username={username}
            theme={theme}
            onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            onSave={handleSaveSettings}
            onSignIn={() => api.auth.signIn()}
            onSignOut={handleSignOut}
            onExport={handleExport}
            onImport={() => setShowImport(true)}
          />
        )}
      </main>

      {view === 'calendar' && selectedCalendarDate && (
        <EventPanel
          date={selectedCalendarDate}
          dayEvents={selectedDayEvents}
          dayTodos={calendarDayTodos}
          dayAdditions={calendarDayAdditions}
          onAddAddition={text => handleAddAdditionForDate(selectedCalendarDate, text)}
          onDeleteAddition={handleDeleteAdditionForDate}
          onToggleAddition={handleToggleAdditionForDate}
          focusEventId={editingEventId}
          onClose={() => { setSelectedCalendarDate(null); setEditingEventId(null) }}
          onAdd={handleAddEvent}
          onEdit={handleEditEvent}
          onDelete={handleDeleteEvent}
          onToggleTodo={handleToggleTodo}
        />
      )}


      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}

      <ToastHost />
      <DialogHost />

      {/* Bottom tab bar — mobile only */}
      <nav className="app-bottom-nav" aria-label="Views">
        {visibleGroups.map(g => (
          <button key={g.id} className={`bottom-nav-btn${currentGroup?.id === g.id ? ' bottom-nav-active' : ''}`} onClick={() => goGroup(g)} aria-current={currentGroup?.id === g.id ? 'page' : undefined}>
            <Icon name={g.icon} />
            {groupBadge(g.id) > 0 && <span className="bottom-nav-badge">{groupBadge(g.id) > 99 ? '99+' : groupBadge(g.id)}</span>}
            <span>{g.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
