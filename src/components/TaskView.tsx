import { useState, useEffect, useRef } from 'react'
import type { TodoItem, AgentTask, AgentTaskStatus } from '../types'

const TERMINAL: AgentTaskStatus[] = ['done', 'failed', 'canceled']

function timeAgo(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
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

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
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

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
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
        <input
          type="date"
          className="todo-due-input-inline"
          value={editDue}
          onChange={e => setEditDue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        />
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
      <span className={`task-text${todo.completed ? ' done' : ''}`} onClick={e => { e.stopPropagation(); startEdit() }}>{todo.text}</span>
      {due && (
        <span className={`todo-due-badge${due.overdue ? ' todo-due-overdue' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          {due.label}
        </span>
      )}
      <button className="task-edit-btn" onClick={e => { e.stopPropagation(); startEdit() }} aria-label="Edit">
        <PencilIcon />
      </button>
      <button className="task-delete" onClick={e => { e.stopPropagation(); onDelete() }} aria-label="Delete">
        <TrashIcon />
      </button>
    </div>
  )
}

const STATUS_LABEL: Record<AgentTaskStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_quota: 'Waiting quota',
  gating: 'Gating',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
}

function AgentTaskRow({ task }: { task: AgentTask }) {
  const [expanded, setExpanded] = useState(false)
  const isTerminal = TERMINAL.includes(task.status)

  return (
    <div className={`agent-task-item agent-task-${task.status}`}>
      <div className="agent-task-header">
        <span className={`agent-task-status agent-task-status-${task.status}`}>
          {!isTerminal && (
            <span className={`agent-task-dot${task.status === 'running' ? ' agent-task-dot-running' : ''}`} />
          )}
          {STATUS_LABEL[task.status]}
        </span>
        <span className="agent-task-title">{task.title}</span>
        <span className="agent-task-time">{timeAgo(task.created_at)}</span>
      </div>

      {task.status === 'failed' && task.error && (
        <div className="agent-task-error">{task.error}</div>
      )}

      {task.status === 'done' && task.summary && (
        <div className="agent-task-summary-wrap">
          <p className={`agent-task-summary${expanded ? ' expanded' : ''}`}>{task.summary}</p>
          {task.summary.length > 140 && (
            <button className="agent-task-expand" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {task.pr_url && (
        <a className="agent-task-pr" href={task.pr_url} target="_blank" rel="noopener noreferrer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          PR #{task.pr_number}
        </a>
      )}
    </div>
  )
}

function AgentSubmitForm({ onSubmit, onCancel }: { onSubmit: (title: string, prompt: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  async function submit() {
    const t = title.trim(), p = prompt.trim()
    if (!t || !p) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(t, p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit')
      setSubmitting(false)
    }
  }

  return (
    <div className="agent-submit-form">
      <input
        ref={titleRef}
        className="agent-title-input"
        placeholder="Task title"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />
      <textarea
        className="agent-prompt-input"
        placeholder="Describe what the agent should do…"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={4}
      />
      {error && <div className="agent-submit-error">{error}</div>}
      <div className="agent-submit-actions">
        <button
          className="add-task-btn"
          onClick={submit}
          disabled={submitting || !title.trim() || !prompt.trim()}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
        <button className="settings-action-btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </div>
  )
}

interface TaskViewProps {
  todos: TodoItem[]
  onAddTodo: (text: string, dueDate?: string) => void
  onToggleTodo: (id: string) => void
  onEditTodo: (id: string, text: string, dueDate: string | null) => void
  onDeleteTodo: (id: string) => void
  agentTasks: AgentTask[]
  onSubmitAgentTask: (title: string, prompt: string) => Promise<void>
}

export function TaskView({ todos, onAddTodo, onToggleTodo, onEditTodo, onDeleteTodo, agentTasks, onSubmitAgentTask }: TaskViewProps) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [showAgentForm, setShowAgentForm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function submitTodo() {
    const t = text.trim()
    if (!t) return
    onAddTodo(t, dueDate || undefined)
    setText('')
    setDueDate('')
    inputRef.current?.focus()
  }

  return (
    <div className="todo-view">
      <div className="task-board">

        {/* Personal Tasks */}
        <div className="task-section">
          <div className="section-label">Tasks</div>
          {todos.length === 0 && (
            <div className="empty-state">No tasks yet.</div>
          )}
          {todos.length > 0 && (
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
          <div className="add-task">
            <div className="add-task-row">
              <input
                ref={inputRef}
                className="add-task-input"
                placeholder="Add a task…"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitTodo()}
              />
              <input
                type="date"
                className="todo-due-input"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                title="Due date (optional)"
              />
              <button className="add-task-btn" onClick={submitTodo}>Add</button>
            </div>
          </div>
        </div>

        {/* Agent Queue */}
        <div className="task-section agent-tasks-section">
          <div className="agent-tasks-header">
            <span className="section-label">Agent Queue</span>
            <button
              className="icon-btn agent-tasks-new-btn"
              onClick={() => setShowAgentForm(v => !v)}
              title="Submit new agent task"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>

          {showAgentForm && (
            <AgentSubmitForm
              onSubmit={async (title, prompt) => {
                await onSubmitAgentTask(title, prompt)
                setShowAgentForm(false)
              }}
              onCancel={() => setShowAgentForm(false)}
            />
          )}

          {agentTasks.length === 0 && !showAgentForm && (
            <div className="empty-state" style={{ fontSize: 'var(--kp-text-sm)' }}>
              No agent tasks yet.
            </div>
          )}

          {agentTasks.map(t => <AgentTaskRow key={t.id} task={t} />)}
        </div>

      </div>
    </div>
  )
}
