import { useState, useEffect, useCallback, useRef } from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { DayTabs } from './components/DayTabs'
import { QuestBoard } from './components/QuestBoard'
import { SettingsPanel, downloadExport } from './components/SettingsPanel'
import { SignInModal } from './components/SignInModal'
import { ImportModal } from './components/ImportModal'
import { storage } from './lib/storage'
import { api } from './lib/api'
import { getActiveSlotDate, getNextSlotDate } from './lib/slots'
import type { Slot, Template, TemplateWithState, Addition, Settings, ExportData, DailyData } from './types'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('task_theme') as Theme | null
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface SlotDailyData {
  completions: string[]
  additions: Addition[]
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

  // Daily data keyed by slotDate
  const [dailyData, setDailyData] = useState<Record<string, SlotDailyData>>({})
  const loadedDatesRef = useRef<Set<string>>(new Set())

  const [selectedSlot, setSelectedSlot] = useState<Slot>('mon')
  const [showSettings, setShowSettings] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [showImport, setShowImport] = useState(false)

  // Derived: date for the currently selected slot
  const selectedSlotDate = activeSlotDate
    ? getNextSlotDate(selectedSlot, activeSlot, activeSlotDate)
    : ''
  const selectedDailyData: SlotDailyData = dailyData[selectedSlotDate] ?? { completions: [], additions: [] }

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

  const loadDaily = useCallback(async (slotDate: string) => {
    if (!slotDate || loadedDatesRef.current.has(slotDate)) return
    loadedDatesRef.current.add(slotDate)
    if (isAuth) {
      const d = await api.daily.get(slotDate).catch(() => null) as DailyData | null
      if (!d) return
      const serverCompletions = d.templates.filter(t => t.completed).map(t => t.id)
      const serverAdditions = d.additions
      setDailyData(prev => {
        const existing = prev[slotDate]
        if (!existing) {
          return { ...prev, [slotDate]: { completions: serverCompletions, additions: serverAdditions } }
        }
        // Merge: server is authoritative for completions; preserve any locally-added
        // additions not yet reflected in this (possibly stale) GET response
        const serverIds = new Set(serverAdditions.map(a => a.id))
        const localOnly = existing.additions.filter(a => !serverIds.has(a.id) && !a.id.startsWith('temp-'))
        return {
          ...prev,
          [slotDate]: {
            completions: serverCompletions,
            additions: [...serverAdditions, ...localOnly],
          },
        }
      })
    } else {
      const d = storage.getDaily(slotDate)
      setDailyData(prev => {
        if (prev[slotDate]) return prev
        return { ...prev, [slotDate]: d }
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
    })
  }, [isAuth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load daily data whenever selected slot changes
  useEffect(() => {
    if (!activeSlotDate) return
    const slotDate = getNextSlotDate(selectedSlot, activeSlot, activeSlotDate)
    loadDaily(slotDate)
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

  // Daily handlers — completions always for active slot date
  async function handleToggleTemplate(id: string) {
    const slotDate = activeSlotDate
    const current = dailyData[slotDate]?.completions ?? []
    const done = current.includes(id)
    const next = done ? current.filter(c => c !== id) : [...current, id]
    setDailyData(prev => ({
      ...prev,
      [slotDate]: { ...(prev[slotDate] ?? { completions: [], additions: [] }), completions: next },
    }))
    if (isAuth) {
      await api.daily.toggleTemplate(id, slotDate, !done).catch(console.error)
    } else {
      const d = storage.getDaily(slotDate)
      storage.setDaily(slotDate, { ...d, completions: next })
    }
  }

  // Bonus task handlers — use selected slot's date
  async function handleAddAddition(text: string) {
    const slotDate = selectedSlotDate
    if (isAuth) {
      const tempId = `temp-${crypto.randomUUID()}`
      const tempAddition: Addition = { id: tempId, slot_date: slotDate, text, completed: false, created_at: Date.now() }
      setDailyData(prev => ({
        ...prev,
        [slotDate]: {
          ...(prev[slotDate] ?? { completions: [], additions: [] }),
          additions: [...(prev[slotDate]?.additions ?? []), tempAddition],
        },
      }))
      try {
        const a = await api.daily.addAddition(slotDate, text)
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [] }),
            additions: (prev[slotDate]?.additions ?? []).map(item => item.id === tempId ? a : item),
          },
        }))
      } catch {
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [] }),
            additions: (prev[slotDate]?.additions ?? []).filter(item => item.id !== tempId),
          },
        }))
      }
    } else {
      const a: Addition = { id: crypto.randomUUID(), slot_date: slotDate, text, completed: false, created_at: Date.now() }
      setDailyData(prev => ({
        ...prev,
        [slotDate]: {
          ...(prev[slotDate] ?? { completions: [], additions: [] }),
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
        ...(prev[slotDate] ?? { completions: [], additions: [] }),
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
          ...(prev[slotDate] ?? { completions: [], additions: [] }),
          additions: (prev[slotDate]?.additions ?? []).map(a => a.id === id ? { ...a, text } : a),
        },
      }))
      try {
        const a = await api.daily.updateAddition(id, text)
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [] }),
            additions: (prev[slotDate]?.additions ?? []).map(item => item.id === id ? a : item),
          },
        }))
      } catch {
        setDailyData(prev => ({
          ...prev,
          [slotDate]: {
            ...(prev[slotDate] ?? { completions: [], additions: [] }),
            additions: (prev[slotDate]?.additions ?? []).map(a => a.id === id ? { ...a, text: original } : a),
          },
        }))
      }
    } else {
      setDailyData(prev => ({
        ...prev,
        [slotDate]: {
          ...(prev[slotDate] ?? { completions: [], additions: [] }),
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
        ...(prev[slotDate] ?? { completions: [], additions: [] }),
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
        onSignIn={() => setShowSignIn(true)}
        onSignOut={handleSignOut}
        onSettings={() => setShowSettings(true)}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />

      <main className="app-main">
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
        />
      </main>

      <Footer />

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
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
