import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { api } from '../lib/api'
import { TASK_DATA_CHANGED } from '../lib/assistantStore'
import { Icon } from './Icons'
import type { AssistantApproval, AssistantPart, BrowserState } from '../types'

type ToolPart = Extract<AssistantPart, { kind: 'tool' }>

function readStore(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

// Tools of the Assistant profile that change the Task app. Each shows what it did; additions can be undone.
export const WRITE_TOOL = /(^|__)(event_add|event_update|todo_add|todo_complete|task_add)$/
export const isWriteTool = (name: string) => WRITE_TOOL.test(name)
export const isApprovalTool = (name: string) => /(^|__)request_approval$/.test(name)

interface ActionResult { created?: 'event' | 'todo' | 'task'; updated?: 'event' | 'todo'; id?: string; title?: string; text?: string; start_date?: string; end_date?: string; time?: string | null; due_date?: string | null; slot_date?: string; completed?: boolean }

function parseResult(part: ToolPart): ActionResult | null {
  if (!part.result || part.result.error) return null
  try { return JSON.parse(part.result.output) as ActionResult } catch { return null }
}

function describe(r: ActionResult): { kind: string; text: string } {
  if (r.created === 'event' || r.updated === 'event') {
    const when = r.start_date === r.end_date || !r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`
    return { kind: r.created ? 'Added event' : 'Updated event', text: `${r.title} · ${when}${r.time ? ` ${r.time}` : ''}` }
  }
  if (r.created === 'todo') return { kind: 'Added todo', text: `${r.text}${r.due_date ? ` · due ${r.due_date}` : ''}` }
  if (r.updated === 'todo') return { kind: r.completed ? 'Marked done' : 'Marked not done', text: r.text ?? '' }
  return { kind: 'Added task', text: `${r.text} · ${r.slot_date}` }
}

export function ActionCard({ part }: { part: ToolPart }) {
  const r = parseResult(part)
  const undoneKey = `kp-undone:${part.id}`
  const [state, setState] = useState<'idle' | 'working' | 'undone'>(() => (readStore(undoneKey) ? 'undone' : 'idle'))
  const [error, setError] = useState<string | null>(null)
  if (!part.result) return <p className="as-meta as-working">Updating your Task app…</p>
  if (!r) return <p className="as-error">Could not change the Task app: {part.result.output}</p>
  const { kind, text } = describe(r)

  const undo = async () => {
    if (!r.id || !r.created) return
    setState('working')
    setError(null)
    try {
      if (r.created === 'event') await api.events.remove(r.id)
      else if (r.created === 'todo') await api.todos.remove(r.id)
      else await api.daily.removeAddition(r.id)
      writeStore(undoneKey, '1')
      setState('undone')
      window.dispatchEvent(new Event(TASK_DATA_CHANGED))
    } catch (err) {
      setState('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="as-proposal as-action">
      <div className="as-proposal-head">
        <Icon name={r.created === 'event' || r.updated === 'event' ? 'calendar' : 'routine'} size={14} />
        <span className="as-proposal-kind">{state === 'undone' ? 'Undone' : kind}</span>
        <span className="as-proposal-title">{text}</span>
        {r.created && state !== 'undone' && (
          <button type="button" className="btn-ghost btn-sm as-action-undo" onClick={undo} disabled={state === 'working'}>Undo</button>
        )}
      </div>
      {error && <p className="as-error">{error}</p>}
    </div>
  )
}

// A step the assistant will not take alone: it waits here. Approve opens the browser's gate for a few minutes.
export function ApprovalCard({ part, onOpenBrowser }: { part: ToolPart; onOpenBrowser?: () => void }) {
  const summary = (part.input as { summary?: string })?.summary ?? ''
  type Answer = 'approved' | 'denied' | 'timed out' | 'cancelled' | 'superseded' | 'failed' | 'error'
  const answered: Answer | null = part.result ? ((): Answer => {
    if (part.result.error) return 'error'
    try {
      const r = (JSON.parse(part.result.output) as { result?: string }).result
      return r === 'approved' || r === 'denied' || r === 'cancelled' || r === 'superseded' || r === 'failed' ? r : 'timed out'
    } catch { return 'error' }
  })() : null
  const [pending, setPending] = useState<AssistantApproval | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // While waiting, ask the operator which approval is open (the card itself only knows the tool input).
  useEffect(() => {
    if (answered) return
    let stop = false
    const tick = () => api.assistant.approval().then(a => { if (!stop) setPending(a) }, () => {})
    void tick()
    const t = setInterval(tick, 1500)
    return () => { stop = true; clearInterval(t) }
  }, [answered])

  const decide = async (d: 'approve' | 'deny') => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try { await api.assistant.decide(pending.id, d) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }

  return (
    <div className="as-proposal as-approval">
      <div className="as-proposal-head">
        <Icon name="lock" size={14} />
        <span className="as-proposal-kind">Needs your approval</span>
      </div>
      <p className="as-proposal-summary">{summary}</p>
      {pending?.url && <p className="as-meta as-approval-url">{pending.url}</p>}
      {error && <p className="as-error">{error}</p>}
      <div className="as-proposal-actions">
        {answered === 'approved' && <span className="as-meta">Approved</span>}
        {answered === 'denied' && <span className="as-meta">Denied</span>}
        {answered === 'timed out' && <span className="as-meta">No answer in time, nothing was done</span>}
        {answered === 'cancelled' && <span className="as-meta">Cancelled, nothing was done</span>}
        {answered === 'superseded' && <span className="as-meta">Replaced by a newer request, nothing was done</span>}
        {answered === 'failed' && <span className="as-meta">The approval could not be applied (the browser did not answer); nothing was done</span>}
        {answered === 'error' && <span className="as-meta">Could not ask for approval</span>}
        {!answered && (
          <>
            <button type="button" className="btn-primary btn-sm" onClick={() => decide('approve')} disabled={busy || !pending}>Approve</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => decide('deny')} disabled={busy || !pending}>Deny</button>
            {onOpenBrowser && <button type="button" className="btn-ghost btn-sm" onClick={onOpenBrowser}><Icon name="globe" size={14} /> Show page</button>}
          </>
        )}
      </div>
    </div>
  )
}

const SITES = [
  { label: 'Coupang', url: 'https://www.coupang.com/' },
  { label: 'Catch Table', url: 'https://www.catchtable.co.kr/' },
  { label: '정부24', url: 'https://www.gov.kr/portal/main' },
]

// The assistant's one browser, live: the real Chrome on the homeserver. The owner can type an address, click, type and
// scroll in it (to sign in, solve a robot check, confirm on the phone, or just watch); the assistant works in the same page.
export function BrowserPanel({ onClose }: { onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [info, setInfo] = useState<BrowserState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [addr, setAddr] = useState('')
  const [editingAddr, setEditingAddr] = useState(false)
  const [pending, setPending] = useState<AssistantApproval | null>(null)
  const [deciding, setDeciding] = useState(false)
  const last = useRef<string | null>(null)
  const editingAddrRef = useRef(false)
  editingAddrRef.current = editingAddr
  const imgRef = useRef<HTMLImageElement>(null)

  const refresh = useCallback(async () => {
    try {
      // A waiting approval is shown here too: on a phone this panel covers the card in the chat.
      api.assistant.approval().then(setPending, () => {})
      const [url, st] = await Promise.all([api.assistant.browserShot(), api.assistant.browserState()])
      if (last.current) URL.revokeObjectURL(last.current)
      last.current = url
      setSrc(url)
      setInfo(st)
      if (!editingAddrRef.current) setAddr(st.url)
      setError(null)
    } catch (err) {
      setError(err instanceof Error && err.message !== 'ASSET_SESSION_EXPIRED' ? err.message : 'Browser is not reachable')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { if (!document.hidden) void refresh() }, 1000)
    return () => { clearInterval(t); if (last.current) URL.revokeObjectURL(last.current) }
  }, [refresh])

  const send = async (ev: Parameters<typeof api.assistant.browserInput>[0]) => {
    try { await api.assistant.browserInput(ev); await refresh() } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const onClick = (e: MouseEvent<HTMLImageElement>) => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r || !r.width) return
    void send({ type: 'click', fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height })
  }
  const decide = async (d: 'approve' | 'deny') => {
    if (!pending) return
    setDeciding(true)
    try { await api.assistant.decide(pending.id, d); setPending(null) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setDeciding(false) }
  }
  const submitText = () => { if (text) { void send({ type: 'text', text }); setText('') } }
  const go = (e: FormEvent) => {
    e.preventDefault()
    const v = addr.trim()
    if (!v) return
    setEditingAddr(false)
    void send({ type: 'open', url: /^https?:\/\//i.test(v) ? v : `https://${v}` })
  }
  // Click the page, then type: printable keys go as text, the named keys as keys. (Korean and other composed text: use the field below.)
  const onScreenKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
    const named = ['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']
    if (e.key.length === 1) { e.preventDefault(); void send({ type: 'text', text: e.key }) }
    else if (named.includes(e.key)) { e.preventDefault(); void send({ type: 'key', key: e.key }) }
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submitText() }
  }

  return (
    <aside className="br-panel" aria-label="Browser">
      <div className="br-head">
        <Icon name="globe" size={14} />
        <span className="br-title" title={info?.url}>{info ? (info.title || info.url) : 'Browser'}</span>
        <button className="icon-btn" onClick={() => void refresh()} aria-label="Refresh view" title="Refresh view"><Icon name="refresh" size={16} /></button>
        <button className="icon-btn" onClick={onClose} aria-label="Close browser" title="Close browser"><Icon name="close" size={16} /></button>
      </div>
      <form className="br-addr" onSubmit={go}>
        <input value={addr} onChange={e => setAddr(e.target.value)} onFocus={() => setEditingAddr(true)} onBlur={() => setEditingAddr(false)} placeholder="Address (https://…)" aria-label="Address" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        <button className="btn-ghost btn-sm" type="submit" disabled={!addr.trim()}>Go</button>
      </form>
      <div className="br-sites">
        {SITES.map(s => <button key={s.url} className="btn-ghost btn-sm" onClick={() => void send({ type: 'open', url: s.url })}>{s.label}</button>)}
      </div>
      {pending && (
        <div className="br-approval">
          <span className="as-proposal-kind"><Icon name="lock" size={12} /> Needs your approval</span>
          <p className="as-proposal-summary">{pending.summary}</p>
          <div className="as-proposal-actions">
            <button className="btn-primary btn-sm" onClick={() => decide('approve')} disabled={deciding}>Approve</button>
            <button className="btn-ghost btn-sm" onClick={() => decide('deny')} disabled={deciding}>Deny</button>
          </div>
        </div>
      )}
      {error && <p className="as-error">{error}</p>}
      <div className="br-screen" tabIndex={0} onKeyDown={onScreenKey} aria-label="Browser page: click it, then type">
        {src ? <img ref={imgRef} src={src} alt="The assistant's browser page" onClick={onClick} draggable={false} /> : !error && <p className="as-meta">Loading…</p>}
      </div>
      <div className="br-controls">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey} placeholder="Type into the focused field" aria-label="Text to type" autoComplete="off" />
        <button className="btn-ghost btn-sm" onClick={submitText} disabled={!text}>Type</button>
        <button className="btn-ghost btn-sm" onClick={() => void send({ type: 'key', key: 'Enter' })}>Enter</button>
        <button className="btn-ghost btn-sm" onClick={() => void send({ type: 'key', key: 'Backspace' })}>Back</button>
        <button className="btn-ghost btn-sm" onClick={() => void send({ type: 'scroll', dy: -500 })} aria-label="Scroll up">Up</button>
        <button className="btn-ghost btn-sm" onClick={() => void send({ type: 'scroll', dy: 500 })} aria-label="Scroll down">Down</button>
      </div>
      <p className="as-meta br-note">This is the real Chrome on the homeserver. Sign in here yourself: the assistant never sees passwords. Click the page, then type. It works in this same page.</p>
    </aside>
  )
}

// An approval that is waiting, wherever the turn that asked for it was started (a card in a chat only shows its own).
// Polls while mounted; renders nothing when none waits. `hide`: the open chat already shows its own card.
export function PendingApproval({ hide }: { hide?: boolean }) {
  const [pending, setPending] = useState<AssistantApproval | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    const tick = () => api.assistant.approval().then(a => { if (!stop) setPending(a) }, () => {})
    void tick()
    const t = setInterval(() => { if (!document.hidden) void tick() }, 3000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  if (!pending || hide) return null
  const decide = async (d: 'approve' | 'deny') => {
    setBusy(true)
    setError(null)
    try { await api.assistant.decide(pending.id, d); setPending(null) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  return (
    <div className="as-proposal as-approval">
      <div className="as-proposal-head"><Icon name="lock" size={14} /><span className="as-proposal-kind">Needs your approval</span></div>
      <p className="as-proposal-summary">{pending.summary}</p>
      {error && <p className="as-error">{error}</p>}
      <div className="as-proposal-actions">
        <button type="button" className="btn-primary btn-sm" onClick={() => decide('approve')} disabled={busy}>Approve</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => decide('deny')} disabled={busy}>Deny</button>
      </div>
    </div>
  )
}
