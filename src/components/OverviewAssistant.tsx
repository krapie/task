import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { ask, assistantStore, isRemoteStreaming, setProfile, startNew, stop } from '../lib/assistantStore'
import { useStepUp } from '../lib/useStepUp'
import { PendingApproval } from './AssistantCards'
import { TurnView } from './AssistantView'
import { Icon } from './Icons'

// A floating one-line Assistant at the bottom of the Overview (owner only): ask, read the answer in a panel that opens
// above the line, answer an approval. It floats over the page, so it takes no room from the panels behind it.
// It always uses the Assistant profile (the one that does things); the Personal profile stays in the Assistant tab.
// Same passkey step-up and the same conversation state as the Assistant tab: "Open in Assistant" continues the chat there.
export default function OverviewAssistant({ isAuth, onOpenAssistant }: { isAuth: boolean; onOpenAssistant: () => void }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(true)
  const s = useSyncExternalStore(assistantStore.subscribe, assistantStore.get)
  const { unlocked, busy: unlocking, error, unlock } = useStepUp('overview', isAuth, () => setInput(''))
  const { profile, chat, live } = s
  const mine = profile === 'assistant'
  const turns = mine ? chat.turns : []
  const last = turns[turns.length - 1]
  const busy = live != null || isRemoteStreaming(s)
  const asking = last?.parts.some(p => p.kind === 'tool' && /(^|__)request_approval$/.test(p.name) && !p.result)

  const send = (e: FormEvent) => {
    e.preventDefault()
    const q = input.trim()
    if (!q || busy) return
    if (!mine) setProfile('assistant')
    setInput('')
    setOpen(true)
    void ask(q)
  }

  return (
    <section className="ov-asst" aria-label="Assistant">
      {error && <p className="as-error ov-asst-note">{error}</p>}
      {unlocked && (
        <>
          <div className="ov-asst-approval"><PendingApproval hide={!!asking} /></div>
          {last && (
            <div className="ov-asst-out">
              <div className="ov-asst-actions">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'Hide answer' : 'Show answer'}</button>
                <button type="button" className="btn-ghost btn-sm" onClick={onOpenAssistant}>Open in Assistant</button>
                {!busy && <button type="button" className="btn-ghost btn-sm" onClick={startNew}>New</button>}
              </div>
              {open && <ol className="as-thread ov-asst-thread"><TurnView turn={last} onOpenBrowser={onOpenAssistant} /></ol>}
            </div>
          )}
        </>
      )}
      <form className="ov-asst-bar" onSubmit={send}>
        <Icon name="assistant" size={16} className="ov-asst-icon" />
        {unlocked ? (
          <>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask the assistant: add an event, check mail, book a table"
              aria-label="Ask the assistant"
              autoComplete="off"
              enterKeyHint="send"
            />
            {busy ? (
              <button type="button" className="as-send" onClick={stop} aria-label="Stop" title="Stop"><Icon name="stop" /></button>
            ) : (
              <button type="submit" className="as-send" disabled={!input.trim()} aria-label="Send" title="Send"><Icon name="send" /></button>
            )}
          </>
        ) : (
          <>
            <span className="ov-asst-locked">Assistant is locked</span>
            <button type="button" className="btn-primary btn-sm" onClick={() => void unlock()} disabled={unlocking}>Show with passkey</button>
          </>
        )}
      </form>
    </section>
  )
}
