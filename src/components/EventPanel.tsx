import { useEffect, useRef, useState } from 'react'
import type { Addition, CalendarEvent, Recurrence, TodoItem } from '../types'

interface EventPanelProps {
  date: string
  dayEvents: CalendarEvent[]
  dayTodos: TodoItem[]
  dayAdditions?: Addition[]
  onAddAddition?: (text: string) => void
  focusEventId?: string | null
  onClose: () => void
  onAdd: (data: { title: string; start_date: string; end_date: string; time?: string; recurrence?: Recurrence }) => void
  onEdit: (id: string, data: { title: string; start_date: string; end_date: string; time?: string; recurrence?: Recurrence }) => void
  onDelete: (id: string) => void
  onToggleTodo: (id: string) => void
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
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

const RECURRENCE_LABELS: Record<Recurrence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

interface EventFormProps {
  defaultDate: string
  initial?: CalendarEvent
  onSave: (data: { title: string; start_date: string; end_date: string; time?: string; recurrence?: Recurrence }) => void
  onCancel: () => void
}

function EventForm({ defaultDate, initial, onSave, onCancel }: EventFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [startDate, setStartDate] = useState(initial?.start_date ?? defaultDate)
  const [endDate, setEndDate] = useState(initial?.end_date ?? defaultDate)
  const [time, setTime] = useState(initial?.time ?? '')
  const [multiDay, setMultiDay] = useState(initial ? initial.start_date !== initial.end_date : false)
  const [recurrence, setRecurrence] = useState<Recurrence | ''>(initial?.recurrence ?? '')

  function submit() {
    const t = title.trim()
    if (!t) return
    onSave({
      title: t,
      start_date: startDate,
      end_date: multiDay ? endDate : startDate,
      time: time || undefined,
      recurrence: recurrence || undefined,
    })
  }

  return (
    <div className="event-form">
      <input
        className="add-task-input"
        placeholder="Event title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        autoFocus
      />
      <div className="event-form-row">
        <label className="event-form-label">Date</label>
        <input
          type="date"
          className="event-date-input"
          value={startDate}
          onChange={e => { setStartDate(e.target.value); if (!multiDay) setEndDate(e.target.value) }}
        />
      </div>
      <div className="event-form-row">
        <label className="event-form-label">Time (optional)</label>
        <input
          type="time"
          className="event-date-input"
          value={time}
          onChange={e => setTime(e.target.value)}
        />
      </div>
      <div className="event-form-row">
        <label className="event-form-label">Repeat</label>
        <select
          className="event-date-input"
          value={recurrence}
          onChange={e => setRecurrence(e.target.value as Recurrence | '')}
        >
          <option value="">None</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>
      {!recurrence && (
        <div className="event-form-row">
          <label className="toggle-label" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              style={{ marginRight: 6 }}
              checked={multiDay}
              onChange={e => setMultiDay(e.target.checked)}
            />
            Multi-day event
          </label>
        </div>
      )}
      {!recurrence && multiDay && (
        <div className="event-form-row">
          <label className="event-form-label">End date</label>
          <input
            type="date"
            className="event-date-input"
            value={endDate}
            min={startDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
      )}
      <div className="event-form-actions">
        <button className="add-task-btn" type="button" onClick={submit}>Save</button>
        <button className="settings-action-btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function EventPanel({ date, dayEvents, dayTodos, dayAdditions = [], onAddAddition, focusEventId, onClose, onAdd, onEdit, onDelete, onToggleTodo }: EventPanelProps) {
  const [showForm, setShowForm] = useState(false)
  const [showBonusForm, setShowBonusForm] = useState(false)
  const [bonusText, setBonusText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  const bonusInputRef = useRef<HTMLInputElement>(null)

  function submitBonus() {
    const t = bonusText.trim()
    if (!t) return
    onAddAddition?.(t)
    setBonusText('')
    setShowBonusForm(false)
  }

  function toggleReveal(id: string) { setRevealedId(prev => prev === id ? null : id) }

  const sorted = [...dayEvents].sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))

  useEffect(() => {
    if (focusEventId && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [focusEventId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay cal-modal-overlay" onClick={onClose}>
      <div className="modal cal-modal" onClick={e => e.stopPropagation()}>
        <div className="cal-modal-handle" />
        <div className="modal-header cal-modal-header">
          <span className="modal-title">{formatDisplayDate(date)}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="cal-modal-body">
          {sorted.length === 0 && dayAdditions.length === 0 && dayTodos.length === 0 && !showForm && !onAddAddition && (
            <div className="empty-state cal-modal-empty">No events for this day.</div>
          )}

          {sorted.length > 0 && (
            <div className="cal-event-list">
              <div className="cal-event-list-label">Events</div>
              {sorted.map(event => {
                const isFocused = event.id === focusEventId
                return editingId === event.id ? (
                  <div key={event.id} className="cal-event-item cal-event-item-editing">
                    <EventForm
                      defaultDate={date}
                      initial={event}
                      onSave={data => { onEdit(event.id, data); setEditingId(null) }}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <div
                    key={event.id}
                    ref={isFocused ? focusRef : null}
                    className={['cal-event-item', isFocused ? 'cal-event-item-focused' : '', revealedId === event.id ? 'revealed' : ''].filter(Boolean).join(' ')}
                  >
                    <div className="cal-event-detail">
                      <div className="cal-event-detail-top" onClick={() => toggleReveal(event.id)}>
                        {event.time && <span className="event-item-time">{event.time}</span>}
                        <span className="cal-event-title">{event.title}</span>
                      </div>
                      <div className="cal-event-detail-meta">
                        {event.recurrence && (
                          <span className="event-item-recurrence">↻ {RECURRENCE_LABELS[event.recurrence]}</span>
                        )}
                        {event.start_date !== event.end_date && !event.recurrence && (
                          <span className="event-item-range">{event.start_date} – {event.end_date}</span>
                        )}
                      </div>
                    </div>
                    <div className="cal-event-actions">
                      <button className="task-edit-btn" onClick={() => setEditingId(event.id)} aria-label="Edit">
                        <PencilIcon />
                      </button>
                      <button className="task-delete" onClick={() => onDelete(event.id)} aria-label="Delete">
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(dayAdditions.length > 0 || onAddAddition) && (
            <div className="cal-todo-list">
              <div className="cal-todo-label">Bonus tasks</div>
              {dayAdditions.map(a => (
                <div key={a.id} className={`cal-todo-item${a.completed ? ' cal-todo-done' : ''}`}>
                  <span className={`task-text${a.completed ? ' done' : ''}`}>{a.text}</span>
                </div>
              ))}
              {onAddAddition && (showBonusForm ? (
                <div className="cal-bonus-add-form">
                  <input
                    ref={bonusInputRef}
                    className="add-task-input"
                    placeholder="Bonus task…"
                    value={bonusText}
                    onChange={e => setBonusText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitBonus(); if (e.key === 'Escape') { setShowBonusForm(false); setBonusText('') } }}
                    autoFocus
                  />
                  <div className="event-form-actions">
                    <button className="add-task-btn" type="button" onClick={submitBonus}>Save</button>
                    <button className="settings-action-btn" type="button" onClick={() => { setShowBonusForm(false); setBonusText('') }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="cal-bonus-add">
                  <button className="settings-action-btn" onClick={() => setShowBonusForm(true)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add bonus task
                  </button>
                </div>
              ))}
            </div>
          )}

          {dayTodos.length > 0 && (
            <div className="cal-todo-list">
              <div className="cal-todo-label">Due tasks</div>
              {dayTodos.map(t => (
                <div key={t.id} className={`cal-todo-item${t.completed ? ' cal-todo-done' : ''}`}>
                  <button
                    className={`task-checkbox${t.completed ? ' checked' : ''}`}
                    onClick={() => onToggleTodo(t.id)}
                    aria-label={t.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </button>
                  <span className={`task-text${t.completed ? ' done' : ''}`}>{t.text}</span>
                </div>
              ))}
            </div>
          )}

          {showForm ? (
            <div className="cal-modal-add-form">
              <EventForm
                defaultDate={date}
                onSave={data => { onAdd(data); setShowForm(false) }}
                onCancel={() => setShowForm(false)}
              />
            </div>
          ) : (
            <div className="cal-modal-add">
              <button className="settings-action-btn" onClick={() => setShowForm(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add event
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
