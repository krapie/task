import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type CompositionEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react'
import { api } from '../lib/api'
import { TASK_DATA_CHANGED } from '../lib/assistantStore'
import { Icon } from './Icons'
import type { AssistantApproval, AssistantPart, BrowserInput, BrowserState } from '../types'

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
  { label: 'Naver', url: 'https://www.naver.com/' },
]

const WIDE_KEY = 'kp-as-browser-wide'
const NAMED_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Insert', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)])
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Hyper', 'Super'])
const FAST_MS = 250 // view refresh while the owner is using the page
const IDLE_MS = 1000 // ... and when nothing was touched for a while
const ACTIVE_FOR_MS = 15_000
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// The assistant's one browser, live: the real Chrome on the homeserver, used like a browser. Click, drag, double-click, scroll
// with the wheel (or a finger), type (Korean too: the IME's committed text is sent), use shortcuts and paste, right on the page.
// The agent and the owner share it. Events are queued and sent one at a time; moves and wheel turns are merged, typed
// characters are joined, so a fast typist or a fling does not build a backlog.
export function BrowserPanel({ onClose }: { onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [info, setInfo] = useState<BrowserState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addr, setAddr] = useState('')
  const [editingAddr, setEditingAddr] = useState(false)
  const [pending, setPending] = useState<AssistantApproval | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [wide, setWide] = useState(() => readStore(WIDE_KEY) === '1')
  const last = useRef<string | null>(null)
  const editingAddrRef = useRef(false)
  editingAddrRef.current = editingAddr
  const imgRef = useRef<HTMLImageElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inflight = useRef(false)
  const lastShot = useRef(0)
  const lastState = useRef(0)
  const activeUntil = useRef(0)
  const queue = useRef<BrowserInput[]>([])
  const draining = useRef(false)
  const composing = useRef(false)
  const justEnded = useRef(false)
  const dragging = useRef(false)
  const lastMove = useRef(0)
  const touchY = useRef<number | null>(null)

  const refresh = useCallback(async (withState = true) => {
    if (inflight.current) return
    inflight.current = true
    try {
      // The state (and a waiting approval: on a phone this panel covers the card in the chat) is read about once a second.
      const needState = withState || Date.now() - lastState.current > 1000
      if (needState) { lastState.current = Date.now(); api.assistant.approval().then(setPending, () => {}) }
      const [url, st] = await Promise.all([api.assistant.browserShot(), needState ? api.assistant.browserState() : Promise.resolve(null)])
      const old = last.current
      last.current = url
      setSrc(url)
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1000)
      if (st) { setInfo(st); if (!editingAddrRef.current) setAddr(st.url) }
      setError(null)
    } catch (err) {
      setError(err instanceof Error && err.message !== 'ASSET_SESSION_EXPIRED' ? err.message : 'Browser is not reachable')
    } finally {
      inflight.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      if (document.hidden) return
      const now = Date.now()
      if (now > activeUntil.current && now - lastShot.current < IDLE_MS) return
      lastShot.current = now
      void refresh(false)
    }, FAST_MS)
    return () => { clearInterval(t); if (last.current) URL.revokeObjectURL(last.current) }
  }, [refresh])

  // Sends queued events one at a time, merging neighbours of the same kind.
  const pump = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    try {
      while (queue.current.length) {
        let ev = queue.current.shift()!
        for (let next = queue.current[0]; next; next = queue.current[0]) {
          if (ev.type === 'mouse' && ev.action === 'move' && next.type === 'mouse' && next.action === 'move') ev = queue.current.shift()!
          else if (ev.type === 'wheel' && next.type === 'wheel') { const n = queue.current.shift() as typeof ev; ev = { ...n, dx: ev.dx + n.dx, dy: ev.dy + n.dy } }
          else if (ev.type === 'text' && next.type === 'text') { ev = { type: 'text', text: ev.text + (queue.current.shift() as typeof ev).text } }
          else break
        }
        await api.assistant.browserInput(ev)
      }
      setError(null)
    } catch (err) {
      queue.current = []
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      draining.current = false
    }
    void refresh(true)
  }, [refresh])

  const enqueue = useCallback((ev: BrowserInput) => {
    activeUntil.current = Date.now() + ACTIVE_FOR_MS
    queue.current.push(ev)
    void pump()
  }, [pump])

  // Screen position -> fractions of the page, allowing for the bars the image is letterboxed with.
  const toFrac = (clientX: number, clientY: number) => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) return null
    const r = img.getBoundingClientRect()
    const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight)
    const w = img.naturalWidth * s
    const h = img.naturalHeight * s
    if (!w || !h) return null
    return { fx: clamp01((clientX - (r.left + (r.width - w) / 2)) / w), fy: clamp01((clientY - (r.top + (r.height - h) / 2)) / h) }
  }

  const onMouseDown = (e: MouseEvent<HTMLImageElement>) => {
    e.preventDefault() // no native image drag or selection
    inputRef.current?.focus()
    if (e.button !== 0) return // right click would open a native menu nobody can see on the host
    const p = toFrac(e.clientX, e.clientY)
    if (!p) return
    dragging.current = true
    enqueue({ type: 'mouse', action: 'down', ...p, button: 'left', clicks: Math.max(1, Math.min(3, e.detail)) })
  }
  const onMouseMove = (e: MouseEvent<HTMLImageElement>) => {
    const now = performance.now()
    if (now - lastMove.current < 50) return
    lastMove.current = now
    const p = toFrac(e.clientX, e.clientY)
    if (p) enqueue({ type: 'mouse', action: 'move', ...p })
  }
  // The button can be released outside the image (a drag that ran past the edge).
  useEffect(() => {
    const up = (e: globalThis.MouseEvent) => {
      if (!dragging.current) return
      dragging.current = false
      const p = toFrac(e.clientX, e.clientY)
      if (p) enqueue({ type: 'mouse', action: 'up', ...p, button: 'left' })
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [enqueue])

  // The wheel needs a non-passive listener: the page under the panel must not scroll with it.
  useEffect(() => {
    const el = screenRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 600 : 1
      const p = toFrac(e.clientX, e.clientY)
      enqueue({ type: 'wheel', dx: e.deltaX * k, dy: e.deltaY * k, ...(p ?? {}) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [enqueue])

  // A finger drag scrolls the page (a tap still arrives as a click).
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => { touchY.current = e.touches[0]?.clientY ?? null }
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const y = e.touches[0]?.clientY
    if (y == null || touchY.current == null) return
    const dy = touchY.current - y
    touchY.current = y
    if (dy) enqueue({ type: 'wheel', dx: 0, dy: dy * 2 })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an IME is composing (Korean, Japanese…) the keys belong to it; the committed text arrives with compositionend.
    if (e.nativeEvent.isComposing || e.key === 'Process' || e.key === 'Dead' || e.nativeEvent.keyCode === 229) return
    if (MODIFIER_KEYS.has(e.key)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'v') return // the paste event carries the text
    if (mod || e.altKey) {
      // Shortcuts go to the page with their modifiers; Cmd acts as Control (the host is Linux).
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (k.length !== 1 && !NAMED_KEYS.has(k)) return
      e.preventDefault()
      enqueue({ type: 'key', key: `${mod ? 'Control+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${k}` })
      return
    }
    if (e.key.length === 1) { e.preventDefault(); enqueue({ type: 'text', text: e.key }); return }
    if (NAMED_KEYS.has(e.key)) { e.preventDefault(); enqueue({ type: 'key', key: `${e.shiftKey ? 'Shift+' : ''}${e.key}` }) }
  }
  const onCompositionEnd = (e: CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = false
    if (e.data) { enqueue({ type: 'text', text: e.data }); justEnded.current = true; setTimeout(() => { justEnded.current = false }, 0) }
    e.currentTarget.value = ''
  }
  // Keyboards that do not send usable key events (phones) deliver their text here.
  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const ne = e.nativeEvent as InputEvent
    if (!composing.current && !ne.isComposing && !justEnded.current && ne.data) enqueue({ type: 'text', text: ne.data })
    else if (!composing.current && !ne.isComposing && !ne.data && ne.inputType === 'insertLineBreak') enqueue({ type: 'key', key: 'Enter' })
    if (!composing.current) ta.value = ''
  }
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) enqueue({ type: 'paste', text })
  }

  const decide = async (d: 'approve' | 'deny') => {
    if (!pending) return
    setDeciding(true)
    try { await api.assistant.decide(pending.id, d); setPending(null) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setDeciding(false) }
  }
  const go = (e: FormEvent) => {
    e.preventDefault()
    const v = addr.trim()
    if (!v) return
    setEditingAddr(false)
    enqueue({ type: 'open', url: /^https?:\/\//i.test(v) ? v : `https://${v}` })
  }
  const toggleWide = () => setWide(w => { writeStore(WIDE_KEY, w ? '0' : '1'); return !w })

  return (
    <aside className={`br-panel${wide ? ' br-wide' : ''}`} aria-label="Browser">
      <div className="br-head">
        <Icon name="globe" size={14} />
        <span className="br-title" title={info?.url}>{info ? (info.title || info.url) : 'Browser'}</span>
        <button className="icon-btn br-wide-btn" onClick={toggleWide} aria-label={wide ? 'Narrower browser' : 'Wider browser'} aria-pressed={wide} title={wide ? 'Narrower' : 'Wider'}><Icon name={wide ? 'collapse' : 'expand'} size={16} /></button>
        <button className="icon-btn" onClick={onClose} aria-label="Close browser" title="Close browser"><Icon name="close" size={16} /></button>
      </div>
      <form className="br-addr" onSubmit={go}>
        <button type="button" className="icon-btn" onClick={() => enqueue({ type: 'back' })} aria-label="Back" title="Back"><Icon name="chevronLeft" size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => enqueue({ type: 'forward' })} aria-label="Forward" title="Forward"><Icon name="chevronRight" size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => enqueue({ type: 'reload' })} aria-label="Reload page" title="Reload"><Icon name="refresh" size={16} /></button>
        <input value={addr} onChange={e => setAddr(e.target.value)} onFocus={e => { setEditingAddr(true); e.currentTarget.select() }} onBlur={() => setEditingAddr(false)} placeholder="Address (https://…)" aria-label="Address" autoComplete="off" autoCapitalize="off" spellCheck={false} />
      </form>
      <div className="br-sites">
        {SITES.map(s => <button key={s.url} className="btn-ghost btn-sm" onClick={() => enqueue({ type: 'open', url: s.url })}>{s.label}</button>)}
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
      <div className="br-screen" ref={screenRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onContextMenu={e => e.preventDefault()}>
        {src
          ? <img ref={imgRef} src={src} alt="The assistant's browser page" onMouseDown={onMouseDown} onMouseMove={onMouseMove} draggable={false} />
          : !error && <p className="as-meta">Loading…</p>}
        <textarea
          ref={inputRef}
          className="br-input"
          aria-label="Browser input: click the page, then type"
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={onCompositionEnd}
          onInput={onInput}
          onPaste={onPaste}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          rows={1}
        />
      </div>
      <p className="as-meta br-note">The real Chrome on the homeserver, shared with the assistant. Click, drag, scroll, type and paste right on the page; sign in here yourself, the assistant never sees passwords. Right-click and copying out are not forwarded.</p>
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
