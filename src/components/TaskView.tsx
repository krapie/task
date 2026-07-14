import { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import type { AgentTask, AgentTaskStatus } from '../types'

marked.use({ breaks: true, gfm: true })

const TERMINAL: AgentTaskStatus[] = ['done', 'failed', 'canceled']

// Accepts either an ISO date string or a raw unix timestamp (seconds or ms) —
// the agentq API is expected to send ISO strings, but has previously shipped
// raw unix-second integers, which `new Date()` misreads as milliseconds and
// lands near epoch (1970), showing ~20000+ days ago for every task.
function timeAgo(value: string): string {
  const trimmed = value.trim()
  const asNumber = Number(trimmed)
  const ms = /^-?\d+$/.test(trimmed)
    ? (Math.abs(asNumber) < 1e12 ? asNumber * 1000 : asNumber)
    : new Date(trimmed).getTime()
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
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
        {task.session && task.session !== 'default' && (
          <span className="agent-task-session">{task.session}</span>
        )}
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

function AgentSubmitForm({ onSubmit, onCancel, sessions }: {
  onSubmit: (title: string, prompt: string, session?: string) => Promise<void>
  onCancel: () => void
  sessions: string[]
}) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [session, setSession] = useState(() => {
    const latest = sessions[0]
    return latest && latest !== 'default' ? latest : ''
  })
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
      await onSubmit(t, p, session.trim() || undefined)
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
      <div className="agent-session-row">
        <input
          className="agent-session-input"
          placeholder="Session (optional)"
          value={session}
          onChange={e => setSession(e.target.value)}
          list="agent-session-datalist"
        />
        {sessions.length > 0 && (
          <datalist id="agent-session-datalist">
            {sessions.map(s => <option key={s} value={s} />)}
          </datalist>
        )}
      </div>
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

interface AgentViewProps {
  agentTasks: AgentTask[]
  onSubmitAgentTask: (title: string, prompt: string, session?: string) => Promise<void>
}

const FINISHED_VISIBLE = 3

export function AgentView({ agentTasks, onSubmitAgentTask }: AgentViewProps) {
  const [showAgentForm, setShowAgentForm] = useState(false)
  const [showAllFinished, setShowAllFinished] = useState(false)
  const [sessionFilter, setSessionFilter] = useState<string | null>(null)

  const sorted = [...agentTasks].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Unique sessions, ordered by most recently used
  const sessions = Array.from(
    sorted.reduce((acc, t) => {
      const s = t.session ?? 'default'
      if (!acc.has(s)) acc.set(s, t.created_at)
      return acc
    }, new Map<string, string>()).keys()
  )

  const filtered = sessionFilter
    ? sorted.filter(t => (t.session ?? 'default') === sessionFilter)
    : sorted

  const activeTasks = filtered.filter(t => !TERMINAL.includes(t.status))
  const finishedTasks = filtered.filter(t => TERMINAL.includes(t.status))
  const visibleFinished = showAllFinished ? finishedTasks : finishedTasks.slice(0, FINISHED_VISIBLE)
  const hiddenCount = finishedTasks.length - FINISHED_VISIBLE

  function selectSession(s: string | null) {
    setSessionFilter(s)
    setShowAllFinished(false)
  }

  return (
    <div className="todo-view">
      <div className="task-board">

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
              sessions={sessions}
              onSubmit={async (title, prompt, session) => {
                await onSubmitAgentTask(title, prompt, session)
                setShowAgentForm(false)
              }}
              onCancel={() => setShowAgentForm(false)}
            />
          )}

          {sessions.length > 1 && (
            <div className="agent-session-pills">
              <button
                className={`agent-session-pill${sessionFilter === null ? ' active' : ''}`}
                onClick={() => selectSession(null)}
              >
                All
              </button>
              {sessions.map(s => (
                <button
                  key={s}
                  className={`agent-session-pill${sessionFilter === s ? ' active' : ''}`}
                  onClick={() => selectSession(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 && !showAgentForm && (
            <div className="empty-state" style={{ fontSize: 'var(--kp-text-sm)' }}>
              {agentTasks.length === 0 ? 'No agent tasks yet.' : 'No tasks in this session.'}
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
