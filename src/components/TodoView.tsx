import { useState, useRef } from 'react'
import type { TodoItem } from '../types'

interface TodoViewProps {
  todos: TodoItem[]
  onAdd: (text: string, dueDate?: string) => void
  onToggle: (id: string) => void
  onEdit: (id: string, text: string, dueDate: string | null) => void
  onDelete: (id: string) => void
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
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setEditText(todo.text)
    setEditDue(todo.due_date ?? '')
    setEditing(true)
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
      <div className="todo-item todo-item-editing">
        <input
          ref={inputRef}
          className="todo-edit-input"
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        />
        <input
          type="date"
          className="todo-due-input"
          value={editDue}
          onChange={e => setEditDue(e.target.value)}
        />
        <div className="todo-edit-actions">
          <button className="add-task-btn" onClick={save}>Save</button>
          <button className="settings-action-btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`todo-item${todo.completed ? ' todo-completed' : ''}`}>
      <button
        className={`task-checkbox${todo.completed ? ' checked' : ''}`}
        onClick={onToggle}
        aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </button>
      <span className={`task-text${todo.completed ? ' done' : ''}`} onClick={startEdit}>{todo.text}</span>
      {due && (
        <span className={`todo-due-badge${due.overdue ? ' todo-due-overdue' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          {due.label}
        </span>
      )}
      <button className="task-edit-btn" onClick={startEdit} aria-label="Edit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
        </svg>
      </button>
      <button className="task-delete" onClick={onDelete} aria-label="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
      </button>
    </div>
  )
}

export function TodoView({ todos, onAdd, onToggle, onEdit, onDelete }: TodoViewProps) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function submit() {
    const t = text.trim()
    if (!t) return
    onAdd(t, dueDate || undefined)
    setText('')
    setDueDate('')
    inputRef.current?.focus()
  }

  const active = todos.filter(t => !t.completed)
  const completed = todos.filter(t => t.completed)

  return (
    <div className="todo-view">
      <div className="todo-add-bar">
        <input
          ref={inputRef}
          className="todo-add-input"
          placeholder="Add a task…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <input
          type="date"
          className="todo-due-input"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          title="Due date (optional)"
        />
        <button className="add-task-btn" onClick={submit}>Add</button>
      </div>

      <div className="todo-list-wrap">
        {active.length === 0 && completed.length === 0 && (
          <div className="empty-state" style={{ padding: '32px 24px' }}>No tasks yet.</div>
        )}

        {active.length > 0 && (
          <div className="task-list">
            {active.map(t => (
              <TodoItemRow
                key={t.id}
                todo={t}
                onToggle={() => onToggle(t.id)}
                onEdit={(text, dueDate) => onEdit(t.id, text, dueDate)}
                onDelete={() => onDelete(t.id)}
              />
            ))}
          </div>
        )}

        {completed.length > 0 && (
          <div className="todo-completed-section">
            <button
              className="todo-completed-toggle"
              onClick={() => setShowCompleted(v => !v)}
            >
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ transform: showCompleted ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
              {completed.length} completed
            </button>
            {showCompleted && (
              <div className="task-list">
                {completed.map(t => (
                  <TodoItemRow
                    key={t.id}
                    todo={t}
                    onToggle={() => onToggle(t.id)}
                    onEdit={(text, dueDate) => onEdit(t.id, text, dueDate)}
                    onDelete={() => onDelete(t.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
