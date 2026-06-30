import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { DayTabs } from './components/DayTabs'
import { QuestBoard } from './components/QuestBoard'
import { SettingsPanel, downloadExport } from './components/SettingsPanel'
import { SignInModal } from './components/SignInModal'
import { ImportModal } from './components/ImportModal'
import { CalendarView } from './components/CalendarView'
import { EventPanel } from './components/EventPanel'
import { storage } from './lib/storage'
import { api } from './lib/api'
import { getActiveSlotDate, getNextSlotDate } from './lib/slots'
import type { Slot, Template, TemplateWithState, Addition, Settings, ExportData, DailyData, CalendarEvent, DailyEvent, Recurrence } from './types'

type Theme = 'light' | 'dark'
type View = 'board' | 'calendar'

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

  const [token, setToken] = useState<string | null>(() => localStorage.getItem('task_token'))
  const [username, setUsername] = useState<string | null>(null)
  const isAuth = token !== null

  const [settings, setSettings] = useState<Settings>({ rotateHour: 6, rotateMinute: 0, keepBonus: false })

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
  const [view, setView] = useState<View>('board')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)

  // Derived: date for the currently selected slot
  const selectedSlotDate = activeSlotDate
    ? getNextSlotDate(selectedSlot, activeSlot, activeSlotDate)
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
    const { slot, slotDate } = getActiveSlotDate(s.rotateHour, s.rotateMinute)
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
    })
  }, [isAuth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load daily data whenever selected slot changes
  useEffect(() => {
    if (!activeSlotDate) return
    const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate)
    loadDaily(slotDate)
  }, [selectedSlot, activeSlot, activeSlotDate, loadDaily])

  // Reload events when switching to calendar view
  useEffect(() => {
    if (view === 'calendar') loadAllEvents()
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh current slot data when page becomes visible
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible' || !activeSlotDate) return
      const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate)
      loadedDatesRef.current.delete(slotDate)
      loadDaily(slotDate)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [selectedSlot, activeSlot, activeSlotDate, loadDaily])

  // Check for slot rollover every minute
  useEffect(() => {
    const id = setInterval(() => {
      const { slot, slotDate } = getActiveSlotDate(settings.rotateHour, settings.rotateMinute)
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
    const { slot, slotDate } = getActiveSlotDate(s.rotateHour, s.rotateMinute)
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
    const { slot, slotDate } = getActiveSlotDate(next.rotateHour, next.rotateMinute)
    if (slotDate !== activeSlotDate) {
      setActiveSlot(slot)
      setActiveSlotDate(slotDate)
      setSelectedSlot(slot)
      loadedDatesRef.current = new Set()
      setDailyData({})
    }
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

  return (
    <div className="app">
      <Header
        username={username}
        view={view}
        onToggleView={() => setView(v => v === 'board' ? 'calendar' : 'board')}
        onSignIn={() => setShowSignIn(true)}
        onSignOut={handleSignOut}
        onSettings={() => setShowSettings(true)}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />

      <main className="app-main">
        {view === 'board' ? (
          <>
            <DayTabs
              selected={selectedSlot}
              active={activeSlot}
              onChange={setSelectedSlot}
            />
            <QuestBoard
              slot={selectedSlot}
              slotDate={selectedSlotDate}
              isActive={selectedSlot === activeSlot}
              templates={selectedTemplates}
              additions={selectedDailyData.additions}
              calendarEvents={selectedEvents}
              rotateHour={settings.rotateHour}
              rotateMinute={settings.rotateMinute}
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
            />
          </>
        ) : (
          <CalendarView
            year={calendarMonth.year}
            month={calendarMonth.month}
            events={monthEvents}
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
            onDayClick={date => { setSelectedCalendarDate(prev => prev === date ? null : date); setEditingEventId(null) }}
            onEventClick={event => { setSelectedCalendarDate(event.start_date); setEditingEventId(event.id) }}
          />
        )}
      </main>

      <Footer />

      {view === 'calendar' && selectedCalendarDate && (
        <EventPanel
          date={selectedCalendarDate}
          dayEvents={selectedDayEvents}
          initialEditingId={editingEventId}
          onClose={() => { setSelectedCalendarDate(null); setEditingEventId(null) }}
          onAdd={handleAddEvent}
          onEdit={handleEditEvent}
          onDelete={handleDeleteEvent}
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
    </div>
  )
}
