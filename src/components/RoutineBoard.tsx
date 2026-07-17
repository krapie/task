import { useState, useEffect, useRef } from 'react'
import type { TemplateWithState, Addition, Slot, DailyEvent, TodoItem } from '../types'
import { formatDayLabel, getNextReset, SLOTS } from '../lib/slots'

interface RoutineBoardProps {
  slot: Slot
  slotDate: string
  isActive: boolean
  templates: TemplateWithState[]
  additions: Addition[]
  rotateHour: number
  rotateMinute: number
  slotLabels: Record<Slot, string>
  onToggleTemplate: (id: string) => void
  onAddTemplate: (text: string, slots: Slot[]) => void
  onDeleteTemplate: (id: string) => void
  onEditTemplate: (id: string, text: string) => void
  onMoveTemplate: (id: string, dir: -1 | 1) => void
  calendarEvents: DailyEvent[]
  onAddAddition: (text: string) => void
  onDeleteAddition: (id: string) => void
  onEditAddition: (id: string, text: string) => void
  onToggleAddition: (id: string) => void
  onToggleEvent: (id: string) => void
  todos: TodoItem[]
  onToggleTodo: (id: string) => void
  onAddTodo: (text: string, dueDate?: string) => void
  onEditTodo: (id: string, text: string, dueDate: string | null) => void
  onDeleteTodo: (id: string) => void
}

// --- Date helpers for DatePicker ---
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function pad2(n: number) { return String(n).padStart(2, '0') }
function makeDateStr(y: number, m: number, d: number) { return `${y}-${pad2(m)}-${pad2(d)}` }
function todayDateStr() {
  const n = new Date()
  return makeDateStr(n.getFullYear(), n.getMonth() + 1, n.getDate())
}
function formatDue(dateStr: string): { label: string; overdue: boolean } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
  const overdue = diff < 0
  if (diff === 0) return { label: 'Today', overdue: false }
  if (diff === 1) return { label: 'Tomorrow', overdue: false }
  if (diff === -1) return { label: 'Yesterday', overdue: true }
  if (diff > 0 && diff <= 6) return { label: due.toLocaleDateString('en-US', { weekday: 'short' }), overdue: false }
  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue }
}

function CalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  )
}

function DatePicker({ value, onChange, placeholder = 'Due date' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => value ? parseInt(value.split('-')[0]) : new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => value ? parseInt(value.split('-')[1]) : new Date().getMonth() + 1)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.split('-')[0]))
      setViewMonth(parseInt(value.split('-')[1]))
    }
  }, [value])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function formatLabel(v: string) {
    const [y, m, d] = v.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function buildCells() {
    const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay()
    const days = new Date(viewYear, viewMonth, 0).getDate()
    const cells: (number | null)[] = Array(firstDow).fill(null)
    for (let d = 1; d <= days; d++) cells.push(d)
    return cells
  }

  function prevMonth() {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const today = todayDateStr()

  return (
    <div className="date-picker" ref={ref}>
      <button
        type="button"
        className="date-picker-btn"
        onClick={() => setOpen(v => !v)}
      >
        <CalIcon />
        {value
          ? <span className="date-picker-value">{formatLabel(value)}</span>
          : <span className="date-picker-placeholder">{placeholder}</span>
        }
      </button>
      {value && (
        <button
          type="button"
          className="date-picker-clear"
          onClick={e => { e.stopPropagation(); onChange('') }}
        >
          ×
        </button>
      )}
      {open && (
        <div className="date-picker-popover">
          <div className="date-picker-nav">
            <button type="button" className="date-picker-nav-btn" onClick={prevMonth}>‹</button>
            <span className="date-picker-nav-label">{MONTH_SHORT[viewMonth - 1]} {viewYear}</span>
            <button type="button" className="date-picker-nav-btn" onClick={nextMonth}>›</button>
          </div>
          <div className="date-picker-grid">
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(h => (
              <span key={h} className="date-picker-dow">{h}</span>
            ))}
            {buildCells().map((d, i) => {
              if (d === null) return <span key={i} />
              const ds = makeDateStr(viewYear, viewMonth, d)
              return (
                <button
                  key={i}
                  type="button"
                  className={`date-picker-day${ds === value ? ' selected' : ''}${ds === today ? ' today' : ''}`}
                  onClick={() => { onChange(ds); setOpen(false) }}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Todo row (self-contained edit/reveal state) ---
function TodoItemRow({
  todo,
  onToggle,
  onEdit,
  onDelete,
}: {
  todo: TodoItem
  onToggle: () => void
  onEdit: (text: string, dueDate: string | null) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(todo.text)
  const [editDue, setEditDue] = useState(todo.due_date ?? '')
  const [revealed, setRevealed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setEditText(todo.text)
    setEditDue(todo.due_date ?? '')
    setEditing(true)
    setRevealed(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function save() {
    const t = editText.trim()
    if (t) onEdit(t, editDue || null)
    setEditing(false)
  }

  const due = todo.due_date ? formatDue(todo.due_date) : null

  if (editing) {
    return (
      <div className="task-item task-item-editing">
        <input
          ref={inputRef}
          className="task-edit-input"
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={save}
        />
        <DatePicker value={editDue} onChange={setEditDue} placeholder="No due date" />
      </div>
    )
  }

  return (
    <div
      className={`task-item${todo.completed ? ' task-item-done' : ''}${revealed ? ' revealed' : ''}`}
      onClick={() => setRevealed(v => !v)}
    >
      <button
        className={`task-checkbox${todo.completed ? ' checked' : ''}`}
        onClick={e => { e.stopPropagation(); onToggle() }}
        aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'}
      >
        <CheckIcon />
      </button>
      <span
        className={`task-text${todo.completed ? ' done' : ''}`}
        onClick={e => { e.stopPropagation(); startEdit() }}
      >
        {todo.text}
      </span>
      <div className="task-item-right">
        <button className="task-edit-btn" onClick={e => { e.stopPropagation(); startEdit() }} aria-label="Edit">
          <PencilIcon />
        </button>
        <button className="task-delete" onClick={e => { e.stopPropagation(); onDelete() }} aria-label="Delete">
          <TrashIcon />
        </button>
        {due && (
          <span className={`todo-due-badge${due.overdue ? ' todo-due-overdue' : ''}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            {due.label}
          </span>
        )}
      </div>
    </div>
  )
}

// --- Shared icon components ---
function useCountdown(rotateHour: number, rotateMinute: number) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    function tick() {
      const next = getNextReset(rotateHour, rotateMinute)
      const diff = next.getTime() - Date.now()
      if (diff <= 0) { setLabel('resetting…'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setLabel(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} to reset`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [rotateHour, rotateMinute])

  return label
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  )
}

function DailyTaskAddInput({ slot: currentSlot, onAdd, slotLabels }: { slot: Slot; onAdd: (text: string, slots: Slot[]) => void; slotLabels: Record<Slot, string> }) {
  const [text, setText] = useState('')
  const [selectedDays, setSelectedDays] = useState<Slot[]>([currentSlot])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelectedDays([currentSlot])
  }, [currentSlot])

  function toggleDay(s: Slot) {
    setSelectedDays(prev =>
      prev.includes(s)
        ? prev.length > 1 ? prev.filter(d => d !== s) : prev
        : [...prev, s]
    )
  }

  function submit() {
    const t = text.trim()
    if (!t) return
    onAdd(t, selectedDays)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <div className="add-task">
      <div className="day-toggle-row">
        {SLOTS.map(s => (
          <button
            key={s}
            type="button"
            className={`day-toggle-chip${selectedDays.includes(s) ? ' selected' : ''}`}
            onClick={() => toggleDay(s)}
          >
            {slotLabels[s]}
          </button>
        ))}
      </div>
      <div className="add-task-row">
        <input
          ref={inputRef}
          className="add-task-input"
          placeholder="Add daily task…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      </div>
      <button className="add-task-btn add-task-btn-full" type="button" onClick={submit}>Add</button>
    </div>
  )
}

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function submit() {
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <div className="add-task">
      <div className="add-task-row">
        <input
          ref={inputRef}
          className="add-task-input"
          placeholder={placeholder}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      </div>
      <button className="add-task-btn add-task-btn-full" type="button" onClick={submit}>Add</button>
    </div>
  )
}

function AddTodoInput({ onAdd }: { onAdd: (text: string, dueDate?: string) => void }) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function submit() {
    const t = text.trim()
    if (!t) return
    onAdd(t, dueDate || undefined)
    setText('')
    setDueDate('')
    inputRef.current?.focus()
  }

  return (
    <div className="add-task">
      <div className="add-task-row">
        <input
          ref={inputRef}
          className="add-task-input"
          placeholder="Add a task…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <DatePicker value={dueDate} onChange={setDueDate} />
      </div>
      <button className="add-task-btn add-task-btn-full" type="button" onClick={submit}>Add</button>
    </div>
  )
}

function MobileAddInput({
  slot,
  isActive,
  onAddTemplate,
  onAddAddition,
  onAddTodo,
  slotLabels,
}: {
  slot: Slot
  isActive: boolean
  onAddTemplate: (text: string, slots: Slot[]) => void
  onAddAddition: (text: string) => void
  onAddTodo: (text: string, dueDate?: string) => void
  slotLabels: Record<Slot, string>
}) {
  const [text, setText] = useState('')
  const [type, setType] = useState<'daily' | 'bonus' | 'task'>('daily')
  const [dueDate, setDueDate] = useState('')
  const [selectedDays, setSelectedDays] = useState<Slot[]>([slot])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setSelectedDays([slot]) }, [slot])

  function switchType(t: 'daily' | 'bonus' | 'task') {
    setType(t)
    setText('')
    setDueDate('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function toggleDay(s: Slot) {
    setSelectedDays(prev =>
      prev.includes(s)
        ? prev.length > 1 ? prev.filter(d => d !== s) : prev
        : [...prev, s]
    )
  }

  function submit() {
    const t = text.trim()
    if (!t) return
    if (type === 'daily') onAddTemplate(t, selectedDays)
    else if (type === 'bonus') onAddAddition(t)
    else onAddTodo(t, dueDate || undefined)
    setText('')
    setDueDate('')
    inputRef.current?.focus()
  }

  const placeholder =
    type === 'daily' ? 'Add daily task…'
    : type === 'bonus' ? (isActive ? 'Add bonus task for today…' : `Add bonus task for ${slotLabels[slot]}…`)
    : 'Add a task…'

  return (
    <div className="mobile-add">
      <div className="mobile-add-toggle">
        {(['daily', 'bonus', 'task'] as const).map(t => (
          <button
            key={t}
            type="button"
            className={`mobile-add-type${type === t ? ' selected' : ''}`}
            onClick={() => switchType(t)}
          >
            {t === 'daily' ? 'Daily' : t === 'bonus' ? 'Bonus' : 'Task'}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        className="add-task-input"
        placeholder={placeholder}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
      {type === 'daily' && (
        <div className="day-toggle-row">
          {SLOTS.map(s => (
            <button
              key={s}
              type="button"
              className={`day-toggle-chip${selectedDays.includes(s) ? ' selected' : ''}`}
              onClick={() => toggleDay(s)}
            >
              {slotLabels[s]}
            </button>
          ))}
        </div>
      )}
      {type === 'task' && (
        <DatePicker value={dueDate} onChange={setDueDate} />
      )}
      <button className="add-task-btn add-task-btn-full" type="button" onClick={submit}>Add</button>
    </div>
  )
}

interface EditInputProps {
  initialText: string
  onConfirm: (text: string) => void
  onCancel: () => void
}

function EditInput({ initialText, onConfirm, onCancel }: EditInputProps) {
  const [text, setText] = useState(initialText)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function confirm() {
    const t = text.trim()
    if (t && t !== initialText) onConfirm(t)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      className="task-edit-input"
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') confirm()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={confirm}
    />
  )
}

export function RoutineBoard({
  slot,
  slotDate,
  isActive,
  templates,
  additions,
  rotateHour,
  rotateMinute,
  slotLabels,
  onToggleTemplate,
  calendarEvents,
  onAddTemplate,
  onDeleteTemplate,
  onEditTemplate,
  onMoveTemplate,
  onAddAddition,
  onDeleteAddition,
  onEditAddition,
  onToggleAddition,
  onToggleEvent,
  todos,
  onToggleTodo,
  onAddTodo,
  onEditTodo,
  onDeleteTodo,
}: RoutineBoardProps) {
  const countdown = useCountdown(rotateHour, rotateMinute)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [revealedId, setRevealedId] = useState<string | null>(null)

  const completedCount = templates.filter(t => t.completed).length + additions.filter(a => a.completed).length + calendarEvents.filter(e => e.completed).length
  const totalCount = templates.length + additions.length + calendarEvents.length

  function startEdit(id: string) { setEditingId(id); setRevealedId(null) }
  function cancelEdit() { setEditingId(null) }
  function toggleReveal(id: string) { setRevealedId(prev => prev === id ? null : id) }

  return (
    <div>
      <div className="slot-header">
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--kp-text-base)', color: 'var(--kp-fg)' }}>
            {slotDate ? formatDayLabel(slotDate) : slotLabels[slot]}
          </div>
          {slotDate && (
            <div className="slot-date">
              {slotDate}{!isActive && ' · upcoming'}
            </div>
          )}
        </div>
        <div className="slot-meta">
          {isActive && totalCount > 0 && (
            <span className="progress-label">{completedCount} / {totalCount}</span>
          )}
          {isActive && <span className="reset-countdown">{countdown}</span>}
        </div>
      </div>

      <div className="task-board">
        {/* Daily Tasks */}
        <div className="task-section">
          <div className="section-label">Daily Tasks</div>
          {templates.length > 0 ? (
            <div className="task-list">
              {templates.map((t, i) => {
                const done = isActive ? t.completed : false
                return (
                  <div key={t.id} className={`task-item${revealedId === t.id ? ' revealed' : ''}`}>
                    {isActive ? (
                      <button
                        className={`task-checkbox${done ? ' checked' : ''}`}
                        onClick={() => onToggleTemplate(t.id)}
                        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
                      >
                        <CheckIcon />
                      </button>
                    ) : (
                      <div style={{ width: 16, height: 16, border: '1.5px solid var(--kp-fg)', borderRadius: 'var(--kp-radius-sm)', flexShrink: 0 }} />
                    )}
                    {editingId === t.id ? (
                      <EditInput
                        initialText={t.text}
                        onConfirm={text => { onEditTemplate(t.id, text); cancelEdit() }}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <span className={`task-text${done ? ' done' : ''}`} onClick={() => toggleReveal(t.id)}>{t.text}</span>
                    )}
                    {editingId !== t.id && (
                      <>
                        <button className="task-edit-btn" onClick={() => startEdit(t.id)} aria-label="Edit">
                          <PencilIcon />
                        </button>
                        <button className="task-delete" onClick={() => onDeleteTemplate(t.id)} aria-label="Delete">
                          <TrashIcon />
                        </button>
                        <div className="task-reorder">
                          <button
                            className="task-reorder-btn"
                            onClick={() => onMoveTemplate(t.id, -1)}
                            disabled={i === 0}
                            aria-label="Move up"
                          >
                            <ChevronUpIcon />
                          </button>
                          <button
                            className="task-reorder-btn"
                            onClick={() => onMoveTemplate(t.id, 1)}
                            disabled={i === templates.length - 1}
                            aria-label="Move down"
                          >
                            <ChevronDownIcon />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">No daily tasks yet. Add one below.</div>
          )}
          <div className="desktop-add"><DailyTaskAddInput slot={slot} onAdd={onAddTemplate} slotLabels={slotLabels} /></div>
        </div>

        {/* Bonus Tasks + Tasks share right column, stacked directly */}
        <div className="task-board-right">
        <div className="task-section">
          <div className="section-label">
            Bonus Tasks
            {!isActive && slotDate && (
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, color: 'var(--kp-fg-4)' }}>
                — {slotDate}
              </span>
            )}
          </div>
          {additions.length > 0 ? (
            <div className="task-list">
              {additions.map(a => (
                <div key={a.id} className={`task-item${revealedId === a.id ? ' revealed' : ''}`}>
                  <button
                    className={`task-checkbox${a.completed ? ' checked' : ''}`}
                    onClick={() => onToggleAddition(a.id)}
                    aria-label={a.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    <CheckIcon />
                  </button>
                  {editingId === a.id ? (
                    <EditInput
                      initialText={a.text}
                      onConfirm={text => { onEditAddition(a.id, text); cancelEdit() }}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <span className={`task-text${a.completed ? ' done' : ''}`} onClick={() => toggleReveal(a.id)}>{a.text}</span>
                  )}
                  {editingId !== a.id && (
                    <>
                      <button className="task-edit-btn" onClick={() => startEdit(a.id)} aria-label="Edit">
                        <PencilIcon />
                      </button>
                      <button className="task-delete" onClick={() => onDeleteAddition(a.id)} aria-label="Delete">
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            calendarEvents.length === 0 && (
              <div className="empty-state">
                {isActive ? 'No bonus tasks for today.' : `No bonus tasks for ${slotLabels[slot]}.`}
              </div>
            )
          )}
          {calendarEvents.length > 0 && (
            <div className={`task-list${additions.length > 0 ? ' calendar-events-list' : ''}`}>
              {calendarEvents.map(e => (
                <div key={e.id} className="task-item">
                  <button
                    className={`task-checkbox${e.completed ? ' checked' : ''}`}
                    onClick={() => onToggleEvent(e.id)}
                    aria-label={e.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    <CheckIcon />
                  </button>
                  <svg className="event-task-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                  </svg>
                  <span className={`task-text${e.completed ? ' done' : ''}`}>{e.title}</span>
                  {e.time && <span className="event-time-badge">{e.time}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="desktop-add"><AddInput
            placeholder={isActive ? 'Add bonus task for today…' : `Add bonus task for ${slotLabels[slot]}…`}
            onAdd={onAddAddition}
          /></div>
        </div>

        {/* Tasks (todos) */}
        <div className="task-section">
          <div className="section-label">Tasks</div>
          {todos.length === 0 ? (
            <div className="empty-state">No tasks yet.</div>
          ) : (
            <div className="task-list">
              {todos.map(t => (
                <TodoItemRow
                  key={t.id}
                  todo={t}
                  onToggle={() => onToggleTodo(t.id)}
                  onEdit={(text, dueDate) => onEditTodo(t.id, text, dueDate)}
                  onDelete={() => onDeleteTodo(t.id)}
                />
              ))}
            </div>
          )}
          <div className="desktop-add"><AddTodoInput onAdd={onAddTodo} /></div>
        </div>
        </div>{/* end task-board-right */}
      </div>

      <MobileAddInput
        slot={slot}
        isActive={isActive}
        onAddTemplate={onAddTemplate}
        onAddAddition={onAddAddition}
        onAddTodo={onAddTodo}
        slotLabels={slotLabels}
      />
    </div>
  )
}
