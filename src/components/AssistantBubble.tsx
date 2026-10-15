// The assistant, minimised to a chat button at the bottom right of every tab
// but its own. It opens a small panel with the open conversation: asking here
// adds a turn to the same chat (streamed in both places), and the Assistant
// tab picks up exactly where this left off. Same passkey lock as the tab.
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useStepUp } from '../lib/useStepUp'
import { ask, assistantStore, isRemoteStreaming, startNew, stop } from '../lib/assistantStore'
import { Icon } from './Icons'
import { SUGGESTIONS, TurnView } from './AssistantView'

export default function AssistantBubble({ isAuth, onOpenTab }: { isAuth: boolean; onOpenTab: () => void }) {
  const s = useSyncExternalStore(assistantStore.subscribe, assistantStore.get)
  const { chat, live } = s
  const busy = live != null || isRemoteStreaming(s)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const last = chat.turns[chat.turns.length - 1]
  const earlier = chat.turns.length - 1

  // Also keeps the lock timers (background, expiry) running while only the button is used.
  const { unlocked, busy: unlocking, error, unlock } = useStepUp('assistant', isAuth, () => setInput(''))

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

  return (
    <>
      {open && (
        <section className="as-fab-panel" role="dialog" aria-label="Assistant">
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
