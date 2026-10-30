// The assistant, minimised to a chat button at the bottom right of every tab
// but its own. It opens a small panel with the open conversation: asking here
// adds a turn to the same chat (streamed in both places), and the Assistant
// tab picks up exactly where this left off. Same passkey lock as the tab.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStepUp } from '../lib/useStepUp'
import { ask, assistantStore, isRemoteStreaming, startNew, stop } from '../lib/assistantStore'
import { Icon } from './Icons'
import { SUGGESTIONS, TurnView } from './AssistantView'

// The passkey prompt leaves the page: remember that the panel was open so it is open again on return.
// Read once and ignored after 5 minutes, so a later visit never opens it by surprise.
const REOPEN_KEY = 'task-bubble-reopen'
const REOPEN_MAX_AGE_MS = 5 * 60_000
function markReopen() {
  try { sessionStorage.setItem(REOPEN_KEY, String(Date.now())) } catch { /* the panel stays closed */ }
}
function takeReopen(): boolean {
  try {
    const at = Number(sessionStorage.getItem(REOPEN_KEY))
    sessionStorage.removeItem(REOPEN_KEY)
    return at > 0 && Date.now() - at < REOPEN_MAX_AGE_MS
  } catch {
    return false
  }
}

// The panel sits at the bottom right, so dragging its left or top edge (or the corner) grows it.
// The size is remembered per browser; the limits keep it inside the window.
const SIZE_KEY = 'kp-as-fab-size'
const SIZE_MIN = { w: 340, h: 320 }
const SIZE_DEFAULT = { w: 440, h: 600 }
const SIZE_STEP = 24
type Size = { w: number; h: number }
const fitSize = (s: Size): Size => ({
  w: Math.round(Math.min(Math.max(s.w, SIZE_MIN.w), Math.max(SIZE_MIN.w, window.innerWidth - 48))),
  h: Math.round(Math.min(Math.max(s.h, SIZE_MIN.h), Math.max(SIZE_MIN.h, window.innerHeight - 140))),
})
function readSize(): Size {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null')
    if (v && Number.isFinite(v.w) && Number.isFinite(v.h)) return { w: v.w, h: v.h }
  } catch { /* the default size */ }
  return SIZE_DEFAULT
}
function writeSize(s: Size) {
  try { localStorage.setItem(SIZE_KEY, JSON.stringify(s)) } catch { /* the size is not remembered */ }
}

export default function AssistantBubble({ isAuth, onOpenTab }: { isAuth: boolean; onOpenTab: () => void }) {
  const s = useSyncExternalStore(assistantStore.subscribe, assistantStore.get)
  const { chat, live } = s
  const busy = live != null || isRemoteStreaming(s)
  const [open, setOpen] = useState(takeReopen)
  const [input, setInput] = useState('')
  const [size, setSize] = useState<Size>(() => fitSize(readSize()))
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const last = chat.turns[chat.turns.length - 1]
  const earlier = chat.turns.length - 1

  // Also keeps the lock timers (background, expiry) running while only the button is used.
  const { unlocked, busy: unlocking, error, unlock: doUnlock } = useStepUp('assistant', isAuth, () => setInput(''))
  const unlock = () => { markReopen(); void doUnlock() }

  // Follow the answer while it streams; a finished one reads from the top.
  useEffect(() => {
    const el = bodyRef.current
    if (el && busy) el.scrollTop = el.scrollHeight
  }, [last, busy, open])
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-overlay') && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = (q: string) => {
    q = q.trim()
    if (!q || busy) return
    setInput('')
    void ask(q)
  }
  const submit = (e: FormEvent) => { e.preventDefault(); send(input) }
  const openTab = () => { setOpen(false); onOpenTab() }

  // axis: which sides the handle moves; dragging left grows the width, dragging up grows the height.
  const resizeTo = (next: Size) => { const v = fitSize(next); setSize(v); writeSize(v) }
  const startDrag = (axis: { w?: boolean; h?: boolean }) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    const start = { x: e.clientX, y: e.clientY, ...size }
    const at = (ev: PointerEvent): Size => ({ w: axis.w ? start.w + start.x - ev.clientX : start.w, h: axis.h ? start.h + start.y - ev.clientY : start.h })
    el.setPointerCapture(e.pointerId)
    setDragging(true)
    let last = fitSize(start)
    const move = (ev: PointerEvent) => { last = fitSize(at(ev)); setSize(last) }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDragging(false)
      resizeTo(last)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onResizerKey = (axis: { w?: boolean; h?: boolean }) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const grow = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    const shrink = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    if (grow || shrink) {
      e.preventDefault()
      const d = grow ? SIZE_STEP : -SIZE_STEP
      resizeTo({ w: axis.w ? size.w + d : size.w, h: axis.h ? size.h + d : size.h })
    } else if (e.key === 'Home') {
      e.preventDefault()
      resizeTo({ w: axis.w ? SIZE_DEFAULT.w : size.w, h: axis.h ? SIZE_DEFAULT.h : size.h })
    }
  }
  const resetSize = (axis: { w?: boolean; h?: boolean }) => resizeTo({ w: axis.w ? SIZE_DEFAULT.w : size.w, h: axis.h ? SIZE_DEFAULT.h : size.h })
  const handle = (cls: string, label: string, axis: { w?: boolean; h?: boolean }, orientation?: 'vertical' | 'horizontal') => (
    <div
      className={`as-fab-resizer ${cls}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      onPointerDown={startDrag(axis)}
      onKeyDown={onResizerKey(axis)}
      onDoubleClick={() => resetSize(axis)}
    />
  )

  return (
    <>
      {open && (
        <section
          className={`as-fab-panel${dragging ? ' as-dragging' : ''}`}
          role="dialog"
          aria-label="Assistant"
          style={{ '--as-fab-w': `${size.w}px`, '--as-fab-h': `${size.h}px` } as CSSProperties}
        >
          {handle('as-fab-resize-l', 'Resize the assistant panel width', { w: true }, 'vertical')}
          {handle('as-fab-resize-t', 'Resize the assistant panel height', { h: true }, 'horizontal')}
          {handle('as-fab-resize-tl', 'Resize the assistant panel', { w: true, h: true })}
          <div className="as-fab-head">
            <div className="as-fab-title">
              <span className="as-fab-name">Assistant</span>
              {unlocked && chat.turns.length > 0 && <span className="as-meta as-fab-chat" title={chat.title}>{chat.title}</span>}
            </div>
            <div className="as-fab-actions">
              {unlocked && (busy ? (
                <button className="btn-ghost btn-sm" onClick={stop}><Icon name="stop" size={14} /> Stop</button>
              ) : chat.turns.length > 0 && (
                <button className="btn-ghost btn-sm" onClick={startNew} title="Start a new chat">New</button>
              ))}
              <button className="icon-btn" onClick={openTab} aria-label="Open the Chats tab" title="Open the Chats tab"><Icon name="expand" size={16} /></button>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close"><Icon name="close" size={16} /></button>
            </div>
          </div>
          {!unlocked ? (
            <div className="as-fab-locked">
              <Icon name="lock" size={24} className="empty-icon" />
              <p className="as-meta">The assistant reads your money, health and mail, so it needs your passkey.</p>
              <button className="btn-primary btn-sm" onClick={unlock} disabled={unlocking}>Unlock with passkey</button>
              {error && <p className="as-error">{error}</p>}
            </div>
          ) : (
            <>
              <div className="as-fab-body" ref={bodyRef}>
                {!last ? (
                  <div className="as-fab-suggestions">
                    {SUGGESTIONS.slice(0, 4).map(q => <button key={q} className="as-suggestion" onClick={() => send(q)}>{q}</button>)}
                  </div>
                ) : (
                  <>
                    {earlier > 0 && (
                      <button className="as-fab-earlier as-meta" onClick={openTab}>
                        {earlier} earlier message{earlier > 1 ? 's' : ''} in this chat
                      </button>
                    )}
                    <ol className="as-thread as-fab-thread"><TurnView turn={last} /></ol>
                  </>
                )}
              </div>
              <form className="as-fab-form" onSubmit={submit}>
                <input
                  ref={inputRef}
                  className="field-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={chat.turns.length ? 'Ask a follow-up…' : 'Ask about your tasks, money, health…'}
                  maxLength={2000}
                  disabled={busy}
                />
                <button className="icon-btn" type="submit" aria-label="Ask" title="Ask" disabled={!input.trim() || busy}><Icon name="send" /></button>
              </form>
            </>
          )}
        </section>
      )}
      <button
        className={`as-fab${open ? ' as-fab-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close the assistant' : 'Ask the assistant'}
        aria-expanded={open}
        title={open ? 'Close the assistant' : 'Ask the assistant'}
      >
        <Icon name={open ? 'close' : 'chat'} size={24} />
        {busy && !open && <span className="as-fab-dot" />}
      </button>
    </>
  )
}
