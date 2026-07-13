import { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import type { TodoItem, AgentTask, AgentTaskStatus } from '../types'

marked.use({ breaks: true, gfm: true })

const TERMINAL: AgentTaskStatus[] = ['done', 'failed', 'canceled']

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function pad2(n: number) { return String(n).padStart(2, '0') }
function makeDateStr(y: number, m: number, d: number) { return `${y}-${pad2(m)}-${pad2(d)}` }
function todayDateStr() {
  const n = new Date()
  return makeDateStr(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

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
  const [showPrompt, setShowPrompt] = useState(false)
  const isTerminal = TERMINAL.includes(task.status)

  const summaryHtml = task.summary ? marked.parse(task.summary) as string : null

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

      {task.prompt && (
        <div className="agent-task-desc-wrap">
          <button
            className="agent-task-desc-toggle"
            onClick={() => setShowPrompt(v => !v)}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: showPrompt ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            Description
          </button>
          {showPrompt && (
            <div className="agent-task-desc">{task.prompt}</div>
          )}
        </div>
      )}

      {task.status === 'failed' && task.error && (
        <div className="agent-task-error">{task.error}</div>
      )}

      {summaryHtml && (
        <div className="agent-task-summary-wrap">
          <div
            className={`agent-task-md${expanded ? '' : ' agent-task-md-collapsed'}`}
            dangerouslySetInnerHTML={{ __html: summaryHtml }}
          />
          {task.summary!.length > 300 && (
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

const FINISHED_VISIBLE = 3

export function TaskView({ todos, onAddTodo, onToggleTodo, onEditTodo, onDeleteTodo, agentTasks, onSubmitAgentTask }: TaskViewProps) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [showAgentForm, setShowAgentForm] = useState(false)
  const [showAllFinished, setShowAllFinished] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const activeTasks = agentTasks.filter(t => !TERMINAL.includes(t.status))
  const finishedTasks = agentTasks.filter(t => TERMINAL.includes(t.status))
  const visibleFinished = showAllFinished ? finishedTasks : finishedTasks.slice(0, FINISHED_VISIBLE)
  const hiddenCount = finishedTasks.length - FINISHED_VISIBLE

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
              <DatePicker value={dueDate} onChange={setDueDate} />
              <button className="add-task-btn" onClick={submitTodo}>Add</button>
            </div>
          </div>
        </div>

        {/* Agent Tasks */}
        <div className="task-section agent-tasks-section">
          <div className="agent-tasks-header">
            <span className="section-label">Agent Tasks</span>
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

          {activeTasks.map(t => <AgentTaskRow key={t.id} task={t} />)}
          {visibleFinished.map(t => <AgentTaskRow key={t.id} task={t} />)}

          {finishedTasks.length > FINISHED_VISIBLE && (
            <button
              className="agent-tasks-show-more"
              onClick={() => setShowAllFinished(v => !v)}
            >
              {showAllFinished
                ? 'Show less'
                : `Show ${hiddenCount} older task${hiddenCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
