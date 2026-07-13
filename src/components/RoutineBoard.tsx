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
  dueTodos: TodoItem[]
  onToggleTodo: (id: string) => void
}

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
        <button className="add-task-btn" type="button" onClick={submit}>Add</button>
      </div>
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
        <button className="add-task-btn" type="button" onClick={submit}>Add</button>
      </div>
    </div>
  )
}

function MobileAddInput({
  slot,
  isActive,
  onAddTemplate,
  onAddAddition,
  slotLabels,
}: {
  slot: Slot
  isActive: boolean
  onAddTemplate: (text: string, slots: Slot[]) => void
  onAddAddition: (text: string) => void
  slotLabels: Record<Slot, string>
}) {
  const [text, setText] = useState('')
  const [type, setType] = useState<'daily' | 'bonus'>('daily')
  const inputRef = useRef<HTMLInputElement>(null)

  function submit() {
    const t = text.trim()
    if (!t) return
    if (type === 'daily') onAddTemplate(t, [slot])
    else onAddAddition(t)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <div className="mobile-add">
      <div className="mobile-add-toggle">
        <button
          type="button"
          className={`mobile-add-type${type === 'daily' ? ' selected' : ''}`}
          onClick={() => setType('daily')}
        >
          Daily
        </button>
        <button
          type="button"
          className={`mobile-add-type${type === 'bonus' ? ' selected' : ''}`}
          onClick={() => setType('bonus')}
        >
          Bonus
        </button>
      </div>
      <div className="mobile-add-row">
        <input
          ref={inputRef}
          className="add-task-input"
          placeholder={type === 'daily' ? 'Add daily task…' : isActive ? 'Add bonus task for today…' : `Add bonus task for ${slotLabels[slot]}…`}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <button className="add-task-btn" type="button" onClick={submit}>Add</button>
      </div>
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
  dueTodos,
  onToggleTodo,
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

        {/* Bonus Tasks */}
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

        {/* Due Todos */}
        {dueTodos.length > 0 && (
          <div className="task-section">
            <div className="section-label">Due</div>
            <div className="task-list">
              {dueTodos.map(t => (
                <div key={t.id} className="task-item">
                  <button
                    className={`task-checkbox${t.completed ? ' checked' : ''}`}
                    onClick={() => onToggleTodo(t.id)}
                    aria-label={t.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    <CheckIcon />
                  </button>
                  <svg className="event-task-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span className={`task-text${t.completed ? ' done' : ''}`}>{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <MobileAddInput
        slot={slot}
        isActive={isActive}
        onAddTemplate={onAddTemplate}
        onAddAddition={onAddAddition}
        slotLabels={slotLabels}
      />
    </div>
  )
}
