import { useState, useEffect, useCallback } from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { DayTabs } from './components/DayTabs'
import { QuestBoard } from './components/QuestBoard'
import { SettingsPanel, downloadExport } from './components/SettingsPanel'
import { SignInModal } from './components/SignInModal'
import { ImportModal } from './components/ImportModal'
import { storage } from './lib/storage'
import { api } from './lib/api'
import { getActiveSlotDate } from './lib/slots'
import type { Slot, Template, TemplateWithState, Addition, Settings, ExportData } from './types'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('task_theme') as Theme | null
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  // Theme
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('task_theme', theme)
  }, [theme])

  // Auth
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('task_token'))
  const [username, setUsername] = useState<string | null>(null)
  const isAuth = token !== null

  // Settings
  const [settings, setSettings] = useState<Settings>({ rotateHour: 6, rotateMinute: 0, keepBonus: false })

  // Active slot (recalculated whenever settings change)
  const [activeSlot, setActiveSlot] = useState<Slot>('mon')
  const [activeSlotDate, setActiveSlotDate] = useState<string>('')

  // Templates (all slots)
  const [templates, setTemplates] = useState<Record<Slot, Template[]>>({
    mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [],
  })

  // Daily data for active slot
  const [completions, setCompletions] = useState<string[]>([])
  const [additions, setAdditions] = useState<Addition[]>([])

  // Selected tab
  const [selectedSlot, setSelectedSlot] = useState<Slot>('mon')

  // UI state
  const [showSettings, setShowSettings] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [showImport, setShowImport] = useState(false)

  // Verify token on mount
  useEffect(() => {
    if (!token) return
    api.auth.me().then(u => setUsername(u.username)).catch(() => {
      localStorage.removeItem('task_token')
      setToken(null)
    })
  }, [token])

  // Load settings
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

  // Compute active slot
  const refreshSlot = useCallback((s: Settings) => {
    const { slot, slotDate } = getActiveSlotDate(s.rotateHour, s.rotateMinute)
    setActiveSlot(slot)
    setActiveSlotDate(slotDate)
    setSelectedSlot(prev => {
      // Only auto-switch to active slot if currently viewing active slot
      if (prev === activeSlot || activeSlotDate === '') return slot
      return prev
    })
    return { slot, slotDate }
  }, [activeSlot, activeSlotDate])

  // Load templates
  const loadTemplates = useCallback(async () => {
    if (isAuth) {
      const t = await api.templates.getAll().catch(() => storage.getTemplates())
      setTemplates(t)
      return t
    } else {
      const t = storage.getTemplates()
      setTemplates(t)
      return t
    }
  }, [isAuth])

  // Load daily data
  const loadDaily = useCallback(async (slotDate: string) => {
    if (!slotDate) return
    if (isAuth) {
      const d = await api.daily.get(slotDate).catch(() => null)
      if (d) {
        setCompletions(d.templates.filter(t => t.completed).map(t => t.id))
        setAdditions(d.additions)
      }
    } else {
      const d = storage.getDaily(slotDate)
      setCompletions(d.completions)
      setAdditions(d.additions)
    }
  }, [isAuth])

  // Bootstrap
  useEffect(() => {
    loadSettings().then(s => {
      const { slotDate } = refreshSlot(s)
      loadTemplates()
      loadDaily(slotDate)
    })
  }, [isAuth]) // re-run on auth change

  // Check for slot rollover every minute
  useEffect(() => {
    const id = setInterval(() => {
      const { slot, slotDate } = getActiveSlotDate(settings.rotateHour, settings.rotateMinute)
      if (slotDate !== activeSlotDate) {
        setActiveSlot(slot)
        setActiveSlotDate(slotDate)
        setSelectedSlot(slot)
        setCompletions([])
        setAdditions([])
        loadDaily(slotDate)
      }
    }, 60000)
    return () => clearInterval(id)
  }, [settings, activeSlotDate, loadDaily])

  // Handlers: auth
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
    // Reload from localStorage
    const s = storage.getSettings()
    setSettings(s)
    const { slot, slotDate } = getActiveSlotDate(s.rotateHour, s.rotateMinute)
    setActiveSlot(slot)
    setActiveSlotDate(slotDate)
    setSelectedSlot(slot)
    const t = storage.getTemplates()
    setTemplates(t)
    const d = storage.getDaily(slotDate)
    setCompletions(d.completions)
    setAdditions(d.additions)
  }

  // Handlers: settings
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
      setCompletions([])
      setAdditions([])
      loadDaily(slotDate)
    }
  }

  // Handlers: templates
  async function handleAddTemplate(text: string) {
    const slot = selectedSlot
    if (isAuth) {
      const t = await api.templates.create(slot, text)
      setTemplates(prev => ({ ...prev, [slot]: [...prev[slot], t] }))
    } else {
      const t: Template = { id: crypto.randomUUID(), slot, text, position: templates[slot].length, created_at: Date.now() }
      const next = { ...templates, [slot]: [...templates[slot], t] }
      setTemplates(next)
      storage.setTemplates(next)
    }
  }

  async function handleDeleteTemplate(id: string) {
    const slot = selectedSlot
    if (isAuth) {
      await api.templates.remove(id)
    } else {
      const next = { ...templates, [slot]: templates[slot].filter(t => t.id !== id) }
      setTemplates(next)
      storage.setTemplates(next)
    }
    setTemplates(prev => ({ ...prev, [slot]: prev[slot].filter(t => t.id !== id) }))
    if (slot === activeSlot) {
      setCompletions(prev => prev.filter(c => c !== id))
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
    const next = { ...templates, [slot]: reordered }
    setTemplates(next)
    if (isAuth) {
      await api.templates.reorder(slot, reordered.map(t => t.id)).catch(console.error)
    } else {
      storage.setTemplates(next)
    }
  }

  // Handlers: daily
  async function handleToggleTemplate(id: string) {
    const done = completions.includes(id)
    const next = done ? completions.filter(c => c !== id) : [...completions, id]
    setCompletions(next)
    if (isAuth) {
      await api.daily.toggleTemplate(id, activeSlotDate, !done).catch(console.error)
    } else {
      const d = storage.getDaily(activeSlotDate)
      storage.setDaily(activeSlotDate, { ...d, completions: next })
    }
  }

  async function handleAddAddition(text: string) {
    if (isAuth) {
      const a = await api.daily.addAddition(activeSlotDate, text)
      setAdditions(prev => [...prev, a])
    } else {
      const a: Addition = { id: crypto.randomUUID(), slot_date: activeSlotDate, text, completed: false, created_at: Date.now() }
      const next = [...additions, a]
      setAdditions(next)
      const d = storage.getDaily(activeSlotDate)
      storage.setDaily(activeSlotDate, { ...d, additions: next })
    }
  }

  async function handleDeleteAddition(id: string) {
    if (isAuth) {
      await api.daily.removeAddition(id)
    }
    const next = additions.filter(a => a.id !== id)
    setAdditions(next)
    if (!isAuth) {
      const d = storage.getDaily(activeSlotDate)
      storage.setDaily(activeSlotDate, { ...d, additions: next })
    }
  }

  async function handleToggleAddition(id: string) {
    const a = additions.find(x => x.id === id)
    if (!a) return
    const next = additions.map(x => x.id === id ? { ...x, completed: !x.completed } : x)
    setAdditions(next)
    if (isAuth) {
      await api.daily.toggleAddition(id, !a.completed).catch(console.error)
    } else {
      const d = storage.getDaily(activeSlotDate)
      storage.setDaily(activeSlotDate, { ...d, additions: next })
    }
  }

  // Import / Export
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
      const t = storage.getTemplates()
      setTemplates(t)
    }
  }

  // Build templatesWithState for active slot
  const activeTemplatesWithState: TemplateWithState[] = (templates[activeSlot] ?? []).map(t => ({
    ...t,
    completed: completions.includes(t.id),
  }))

  // For selected (non-active) slot: just templates, no completion state
  const selectedTemplates = selectedSlot === activeSlot
    ? activeTemplatesWithState
    : templates[selectedSlot] ?? []

  const selectedAdditions = selectedSlot === activeSlot ? additions : []

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
          slotDate={activeSlotDate}
          isActive={selectedSlot === activeSlot}
          templates={selectedTemplates}
          additions={selectedAdditions}
          rotateHour={settings.rotateHour}
          rotateMinute={settings.rotateMinute}
          onToggleTemplate={handleToggleTemplate}
          onAddTemplate={handleAddTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onMoveTemplate={handleMoveTemplate}
          onAddAddition={handleAddAddition}
          onDeleteAddition={handleDeleteAddition}
          onToggleAddition={handleToggleAddition}
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
