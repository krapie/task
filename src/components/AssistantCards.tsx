import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type CompositionEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react'
import { api } from '../lib/api'
import { TASK_DATA_CHANGED } from '../lib/assistantStore'
import { confirmDialog } from '../lib/notify'
import { Icon } from './Icons'
import type { AssistantApproval, AssistantPart, BrowserInput, BrowserSite, BrowserState, BrowserStreamEvent } from '../types'

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
const isLoginTool = (name: string) => /(^|__)browser_request_login$/.test(name)
export const isApprovalTool = (name: string) => /(^|__)(request_approval|browser_request_login)$/.test(name)

// Two kinds of waiting question: approve a risky step, or "I'm signed in" after the owner signed in by hand.
const approvalWords = (kind?: string) => kind === 'login'
  ? { head: 'Sign in needed', yes: '', no: 'Cancel', yesDone: 'Signed in: the assistant saw your account', noDone: 'Cancelled' } // nothing to press when done: the assistant watches the page
  : { head: 'Needs your approval', yes: 'Approve', no: 'Deny', yesDone: 'Approved', noDone: 'Denied' }

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
  const inp = part.input as { summary?: string; site?: string }
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

  const words = approvalWords(pending?.kind ?? (isLoginTool(part.name) ? 'login' : undefined))
  const summary = inp?.summary ?? pending?.summary ?? (inp?.site ? `Sign in to ${inp.site} in the Browser panel. Then press "I'm signed in".` : '')
  return (
    <div className="as-proposal as-approval">
      <div className="as-proposal-head">
        <Icon name="lock" size={14} />
        <span className="as-proposal-kind">{words.head}</span>
      </div>
      <p className="as-proposal-summary">{summary}</p>
      {pending?.url && <p className="as-meta as-approval-url">{pending.url}</p>}
      {error && <p className="as-error">{error}</p>}
      <div className="as-proposal-actions">
        {answered === 'approved' && <span className="as-meta">{words.yesDone}</span>}
        {answered === 'denied' && <span className="as-meta">{words.noDone}</span>}
        {answered === 'timed out' && <span className="as-meta">No answer in time, nothing was done</span>}
        {answered === 'cancelled' && <span className="as-meta">Cancelled, nothing was done</span>}
        {answered === 'superseded' && <span className="as-meta">Replaced by a newer request, nothing was done</span>}
        {answered === 'failed' && <span className="as-meta">The approval could not be applied (the browser did not answer); nothing was done</span>}
        {answered === 'error' && <span className="as-meta">Could not ask for approval</span>}
        {!answered && (
          <>
            {words.yes && <button type="button" className="btn-primary btn-sm" onClick={() => decide('approve')} disabled={busy || !pending}>{words.yes}</button>}
            <button type="button" className="btn-ghost btn-sm" onClick={() => decide('deny')} disabled={busy || !pending}>{words.no}</button>
            {onOpenBrowser && <button type="button" className="btn-ghost btn-sm" onClick={onOpenBrowser}><Icon name="globe" size={14} /> Show page</button>}
          </>
        )}
      </div>
    </div>
  )
}

// Shown until the owner's list (api.assistant.sites) has loaded, or when it cannot be read.
const FALLBACK_SITES = [
  { label: 'Coupang', url: 'https://www.coupang.com/' },
  { label: 'Catch Table', url: 'https://www.catchtable.co.kr/' },
  { label: 'Naver', url: 'https://www.naver.com/' },
]

function ago(iso: string | null): string {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
const signInText = (s: BrowserSite) => s.login_status === 'signed_in' ? `Signed in${s.login_checked_at ? ` · checked ${ago(s.login_checked_at)}` : ''}` : s.login_status === 'needs_login' ? 'Needs sign-in' : 'Sign-in not checked'

const NAMED_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Insert', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)])
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Hyper', 'Super'])
// Without the live stream (an older worker, a dropped connection) the page is fetched as a screenshot: often while in use, rarely when idle.
const FAST_MS = 250
const IDLE_MS = 1000
const ACTIVE_FOR_MS = 15_000
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// The assistant's one browser, live: the real Chrome on the homeserver, used like a browser. Click, drag, double-click, scroll
// with the wheel (or a finger), type (Korean too: the IME's committed text is sent), use shortcuts and paste, right on the page.
// The agent and the owner share it. Events are queued and sent one at a time; moves and wheel turns are merged, typed
// characters are joined, so a fast typist or a fling does not build a backlog.
export function BrowserPanel({ onClose, wide, onToggleWide }: { onClose: () => void; wide: boolean; onToggleWide: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [info, setInfo] = useState<BrowserState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addr, setAddr] = useState('')
  const [editingAddr, setEditingAddr] = useState(false)
  const [pending, setPending] = useState<AssistantApproval | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [view, setView] = useState<'page' | 'integrations'>('page')
  const [signIn, setSignIn] = useState<BrowserSite | null>(null)
  const [sites, setSites] = useState<BrowserSite[] | null>(null)
  const [siteNote, setSiteNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ label: '', url: '', login: '' })
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
  const liveRef = useRef(false) // the live stream is delivering frames
  const frameRef = useRef<{ mime: string; data: string } | null>(null)
  const rafRef = useRef(0)

  const refresh = useCallback(async (withState = true) => {
    if (inflight.current) return
    inflight.current = true
    try {
      // The state is read about once a second.
      const needState = withState || Date.now() - lastState.current > 1000
      if (needState) lastState.current = Date.now()
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

  // The sites: loaded now, and again whenever the assistant may have recorded a sign-in (the pending question changes).
  const loadSites = useCallback(() => { api.assistant.sites().then(setSites, () => {}) }, [])
  useEffect(() => { loadSites() }, [loadSites, pending?.id])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      if (document.hidden || liveRef.current) return
      const now = Date.now()
      if (now > activeUntil.current && now - lastShot.current < IDLE_MS) return
      lastShot.current = now
      void refresh(false)
    }, FAST_MS)
    return () => { clearInterval(t); if (last.current) URL.revokeObjectURL(last.current) }
  }, [refresh])

  // A waiting question (on a phone this panel covers the card in the chat) is looked for every second and a half.
  useEffect(() => {
    const tick = () => { if (!document.hidden) api.assistant.approval().then(setPending, () => {}) }
    tick()
    const t = setInterval(tick, 1500)
    return () => clearInterval(t)
  }, [])

  // The live view: frames and page state arrive as a stream; when it cannot (an older worker, a lost connection) the screenshot
  // polling above carries on, and the stream is tried again with a growing pause. It is closed while the tab is hidden.
  useEffect(() => {
    let stop = false
    let ctl: AbortController | null = null
    const onEvent = (ev: BrowserStreamEvent) => {
      if (ev.event === 'frame') {
        liveRef.current = true
        frameRef.current = ev.data
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0
            const f = frameRef.current
            frameRef.current = null
            if (f) { setSrc(`data:${f.mime};base64,${f.data}`); setError(null) }
          })
        }
      } else {
        setInfo(prev => ({ tabs: prev?.tabs ?? 1, gate_open_seconds: prev?.gate_open_seconds ?? 0, url: ev.data.url, title: ev.data.title }))
        if (!editingAddrRef.current) setAddr(ev.data.url)
      }
    }
    const onVisible = () => { if (document.hidden) ctl?.abort() }
    document.addEventListener('visibilitychange', onVisible)
    // A stream that goes silent without closing (a stalled hop) would freeze the page and keep the screenshot fallback off: after 30 s
    // with nothing (the worker sends a ping every 15 s) it is dropped, which turns the fallback back on, and reopened.
    let lastActivity = Date.now()
    const watchdog = setInterval(() => { if (Date.now() - lastActivity > 30_000) ctl?.abort() }, 5000)
    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
    void (async () => {
      let misses = 0
      while (!stop) {
        if (document.hidden) { await wait(500); continue }
        ctl = new AbortController()
        let got = false
        try {
          lastActivity = Date.now()
          await api.assistant.browserStream(ctl.signal, ev => { got = true; onEvent(ev) }, () => { lastActivity = Date.now() })
        } catch { /* falls back to polling */ }
        liveRef.current = false
        if (stop) return
        misses = got ? 0 : misses + 1
        await wait(got ? 300 : Math.min(30_000, 1000 * 2 ** Math.min(misses, 5)))
      }
    })()
    return () => { stop = true; ctl?.abort(); clearInterval(watchdog); document.removeEventListener('visibilitychange', onVisible); if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

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
    if (!liveRef.current) void refresh(true)
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
  const synced = (ok: boolean) => setSiteNote(ok ? null : 'Saved. The browser picks the new list up within a few minutes.')
  const addSite = async (e: FormEvent) => {
    e.preventDefault()
    setSiteNote(null)
    try {
      const login = form.login.split(/[\s,]+/).filter(Boolean)
      const r = await api.assistant.addSite({ label: form.label, url: /^https?:\/\//i.test(form.url.trim()) ? form.url.trim() : `https://${form.url.trim()}`, ...(login.length ? { login_domains: login } : {}) })
      synced(r.synced)
      setForm({ label: '', url: '', login: '' })
      setAdding(false)
      loadSites()
    } catch (err) { setSiteNote(err instanceof Error ? err.message : String(err)) }
  }
  const siteAction = async (fn: () => Promise<{ synced: boolean }>) => {
    setSiteNote(null)
    try { synced((await fn()).synced); loadSites() } catch (err) { setSiteNote(err instanceof Error ? err.message : String(err)) }
  }
  // Integrations → "Set up sign-in": open the site on the page and let the assistant watch it. The owner signs in by hand and presses
  // nothing; the operator marks the site signed in when the page shows the account, and this bar notices (it reads the list every 3 s).
  const signInFrom = useRef<string | null>(null)
  const [signedDone, setSignedDone] = useState(false)
  const signInRef = useRef<BrowserSite | null>(null)
  signInRef.current = signIn
  // The bar appears once the watch really runs (and the baseline is the list as it is now), so it never promises a watch that failed.
  const startSignIn = async (s: BrowserSite) => {
    setError(null)
    try {
      const list = await api.assistant.sites()
      setSites(list)
      signInFrom.current = list.find(x => x.id === s.id)?.login_checked_at ?? null
      await api.assistant.watchSignIn(s.id)
      enqueue({ type: 'open', url: s.url })
      setSignedDone(false)
      setSignIn(s)
      setView('page')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const cancelSignIn = () => {
    if (signIn) api.assistant.stopSignInWatch(signIn.id).catch(() => {})
    setSignIn(null)
    setSignedDone(false)
  }
  // Closing the panel ends the watch; so does the end of the server's 10 minutes (the bar goes with it).
  useEffect(() => () => { if (signInRef.current) api.assistant.stopSignInWatch(signInRef.current.id).catch(() => {}) }, [])
  useEffect(() => {
    if (!signIn) return
    let stop = false
    const t = setInterval(() => {
      api.assistant.sites().then(list => {
        if (stop) return
        setSites(list)
        const s = list.find(x => x.id === signIn.id)
        if (s?.login_status === 'signed_in' && s.login_checked_at !== signInFrom.current) {
          clearInterval(t)
          setSignedDone(true)
          setTimeout(() => { if (!stop) { setSignIn(null); setSignedDone(false) } }, 2500)
        }
      }, () => {})
    }, 3000)
    const end = setTimeout(() => { if (!stop) { setSignIn(null); setSignedDone(false) } }, 10 * 60_000 + 5000)
    return () => { stop = true; clearInterval(t); clearTimeout(end) }
  }, [signIn])

  return (
    <aside className="br-panel" aria-label="Browser">
      <div className="br-head">
        <Icon name={view === 'integrations' ? 'integrations' : 'globe'} size={14} />
        <span className="br-title" title={info?.url}>{view === 'integrations' ? 'Integrations' : info ? (info.title || info.url) : 'Browser'}</span>
        <button className={`icon-btn${view === 'integrations' ? ' icon-btn-active' : ''}`} onClick={() => setView(v => (v === 'page' ? 'integrations' : 'page'))} aria-label="Integrations" aria-pressed={view === 'integrations'} title="Integrations: sites and sign-ins"><Icon name="integrations" size={16} /></button>
        <button className="icon-btn br-wide-btn" onClick={onToggleWide} aria-label={wide ? 'Narrower browser' : 'Wider browser'} aria-pressed={wide} title={wide ? 'Narrower' : 'Wider (or drag the edge)'}><Icon name={wide ? 'collapse' : 'expand'} size={16} /></button>
        <button className="icon-btn" onClick={onClose} aria-label="Close browser" title="Close browser"><Icon name="close" size={16} /></button>
      </div>
      {pending && (
        <div className="br-approval">
          <span className="as-proposal-kind"><Icon name="lock" size={12} /> {approvalWords(pending.kind).head}</span>
          <p className="as-proposal-summary">{pending.summary}</p>
          <div className="as-proposal-actions">
            {approvalWords(pending.kind).yes && <button className="btn-primary btn-sm" onClick={() => decide('approve')} disabled={deciding}>{approvalWords(pending.kind).yes}</button>}
            <button className="btn-ghost btn-sm" onClick={() => decide('deny')} disabled={deciding}>{approvalWords(pending.kind).no}</button>
          </div>
        </div>
      )}
      {error && <p className="as-error">{error}</p>}
      <div className="br-page" hidden={view !== 'page'}>
      <form className="br-addr" onSubmit={go}>
        <button type="button" className="icon-btn" onClick={() => enqueue({ type: 'back' })} aria-label="Back" title="Back"><Icon name="chevronLeft" size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => enqueue({ type: 'forward' })} aria-label="Forward" title="Forward"><Icon name="chevronRight" size={16} /></button>
        <button type="button" className="icon-btn" onClick={() => enqueue({ type: 'reload' })} aria-label="Reload page" title="Reload"><Icon name="refresh" size={16} /></button>
        <input value={addr} onChange={e => setAddr(e.target.value)} onFocus={e => { setEditingAddr(true); e.currentTarget.select() }} onBlur={() => setEditingAddr(false)} placeholder="Address (https://…)" aria-label="Address" autoComplete="off" autoCapitalize="off" spellCheck={false} />
      </form>
      <div className="br-sites">
        {(sites ? sites.filter(s => s.enabled && s.quick_link) : FALLBACK_SITES.map(s => ({ ...s, id: s.url, login_status: 'unknown' as const, login_checked_at: null, login_note: '' }))).map(s => (
          <button key={s.id} className={`btn-ghost btn-sm${s.login_status === 'needs_login' ? ' br-site-warn' : ''}`} onClick={() => enqueue({ type: 'open', url: s.url })} title={'domains' in s ? signInText(s as BrowserSite) : undefined}>{s.label}{s.login_status === 'needs_login' && <span className="br-dot" aria-label="needs sign-in" />}</button>
        ))}
      </div>
      {signIn && (
        <div className="br-signin">
          <span className="as-proposal-kind"><Icon name="lock" size={12} /> {signedDone ? `Signed in to ${signIn.label}` : `Signing in to ${signIn.label}`}</span>
          {!signedDone && <p className="as-meta">Sign in on the page below (a phone confirmation or a robot check too). The assistant watches the page and marks the site signed in by itself; it never sees your password.</p>}
          {!signedDone && (
            <div className="as-proposal-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={cancelSignIn}>Cancel</button>
            </div>
          )}
        </div>
      )}
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
      </div>
      {view === 'integrations' && (
        <div className="br-int">
          <p className="as-meta br-int-intro">The sites the assistant's browser may use. Set up a sign-in once: the browser keeps the session, and the assistant looks at the page before it relies on it. You never give it a password.</p>
          <ul className="br-site-list">
            {(sites ?? []).map(s => (
              <li key={s.id} className={s.enabled ? '' : 'br-site-off'}>
                <div className="br-site-main">
                  <span className="br-site-name">{s.label}</span>
                  <span className="as-meta br-site-domains">{[...s.domains, ...s.login_domains].join(' · ')}</span>
                  <span className={`as-meta br-site-state${s.login_status === 'needs_login' ? ' br-site-state-warn' : ''}`}>{signInText(s)}{s.login_note ? ` · ${s.login_note}` : ''}</span>
                </div>
                <div className="br-site-actions">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void startSignIn(s)} disabled={!s.enabled}>{s.login_status === 'signed_in' ? 'Sign in again' : 'Set up sign-in'}</button>
                  {s.login_status === 'signed_in' && <button type="button" className="btn-ghost btn-sm" onClick={() => void siteAction(() => api.assistant.updateSite(s.id, { login_status: 'needs_login' }))}>Signed out</button>}
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void siteAction(() => api.assistant.updateSite(s.id, { enabled: !s.enabled }))} aria-pressed={s.enabled}>{s.enabled ? 'On' : 'Off'}</button>
                  <button type="button" className="icon-btn" aria-label={`Remove ${s.label}`} title="Remove" onClick={async () => { if (await confirmDialog({ title: 'Remove site', body: `${s.label} leaves the browser's sites.`, confirmLabel: 'Remove', danger: true })) void siteAction(() => api.assistant.removeSite(s.id)) }}><Icon name="close" size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
          {adding ? (
            <form className="br-site-form" onSubmit={addSite}>
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Name" aria-label="Site name" maxLength={40} required />
              <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://www.example.com/" aria-label="Start page" autoCapitalize="off" spellCheck={false} required />
              <input value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="Sign-in through other domains (optional, e.g. kakao.com)" aria-label="Sign-in domains" autoCapitalize="off" spellCheck={false} />
              <div className="as-proposal-actions">
                <button type="submit" className="btn-primary btn-sm">Add site</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setAdding(false); setSiteNote(null) }}>Cancel</button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn-ghost btn-sm br-site-add" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add site</button>
          )}
          {siteNote && <p className="as-meta br-site-note">{siteNote}</p>}
        </div>
      )}
    </aside>
  )
}

// A site the assistant proposed for the browser's list. Nothing is added until Add (the passkey session); the card shows the
// tool input, the operator's result only says whether it exists already.
export function SiteProposal({ part }: { part: ToolPart }) {
  const input = part.input as { label: string; url: string; login_domains?: string[]; note?: string }
  let exists = false
  try { exists = (JSON.parse(part.result?.output ?? '') as { status?: string }).status === 'exists' } catch { /* proposed */ }
  const doneKey = `kp-site-added:${part.id}`
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'dismissed'>(() => (readStore(doneKey) ? 'added' : 'idle'))
  const [error, setError] = useState<string | null>(null)
  const add = async () => {
    setState('adding')
    setError(null)
    try {
      await api.assistant.addSite({ label: input.label, url: input.url, ...(input.login_domains?.length ? { login_domains: input.login_domains } : {}), ...(input.note ? { note: input.note } : {}), created_by: 'assistant' })
      writeStore(doneKey, '1')
      setState('added')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/already in the list/i.test(msg)) { writeStore(doneKey, '1'); setState('added') } else { setState('idle'); setError(msg) }
    }
  }
  let host = input.url
  try { host = new URL(input.url).hostname } catch { /* shown as typed */ }
  return (
    <div className="as-proposal">
      <div className="as-proposal-head">
        <Icon name="globe" size={14} />
        <span className="as-proposal-kind">{exists ? 'Site already listed' : 'Add site to the browser'}</span>
        <span className="as-proposal-title">{input.label}</span>
      </div>
      <p className="as-proposal-summary">{host}{input.login_domains?.length ? ` · signs in through ${input.login_domains.join(', ')}` : ''}</p>
      {input.note && <p className="as-meta">{input.note}</p>}
      {error && <p className="as-error">{error}</p>}
      <div className="as-proposal-actions">
        {exists && <span className="as-meta">Already in the list</span>}
        {!exists && state === 'added' && <span className="as-meta">Added</span>}
        {!exists && state === 'dismissed' && <span className="as-meta">Dismissed</span>}
        {!exists && (state === 'idle' || state === 'adding') && (
          <>
            <button type="button" className="btn-primary btn-sm" onClick={add} disabled={state === 'adding'}>Add</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setState('dismissed')} disabled={state === 'adding'}>Dismiss</button>
          </>
        )}
      </div>
    </div>
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
      <div className="as-proposal-head"><Icon name="lock" size={14} /><span className="as-proposal-kind">{approvalWords(pending.kind).head}</span></div>
      <p className="as-proposal-summary">{pending.summary}</p>
      {error && <p className="as-error">{error}</p>}
      <div className="as-proposal-actions">
        {approvalWords(pending.kind).yes && <button type="button" className="btn-primary btn-sm" onClick={() => decide('approve')} disabled={busy}>{approvalWords(pending.kind).yes}</button>}
        <button type="button" className="btn-ghost btn-sm" onClick={() => decide('deny')} disabled={busy}>{approvalWords(pending.kind).no}</button>
      </div>
    </div>
  )
}
