import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import { confirmDialog } from '../lib/notify'
import { ask, assistantStore, isRemoteStreaming, open, refreshList, remove, setError as setStoreError, startNew, stop } from '../lib/assistantStore'
import StepUpBar from './StepUpBar'
import { Icon } from './Icons'
import { Dialog, Empty, Loading } from './Ui'
import { Markdown } from './Markdown'
import type { AssistantPart, AssistantSummary, AssistantTurn } from '../types'

const MEMORY_KEY = 'portfolio'

export const SUGGESTIONS = [
  'Summarize my week',
  'How much did I spend this month, by category?',
  'Run the Monday market check',
  'Any unread bills or mail that needs a reply?',
  'How did I sleep and train this week?',
]

function fmtOutput(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}

function toolArg(p: Extract<AssistantPart, { kind: 'tool' }>): string {
  const i = p.input as Record<string, unknown>
  return Object.values(i ?? {}).filter(v => typeof v === 'string' || typeof v === 'number').join(' · ').slice(0, 120)
}

function ToolCall({ part }: { part: Extract<AssistantPart, { kind: 'tool' }> }) {
  const state = !part.result ? 'running' : part.result.error ? 'error' : 'ok'
  return (
    <details className="tool-call">
      <summary>
        <span className={`tool-state tool-${state}`} aria-label={state} />
        <span className="tool-name">{part.name}</span>
        <span className="tool-arg">{toolArg(part)}</span>
      </summary>
      <div className="tool-body">
        <div className="tool-label">input</div>
        <pre>{JSON.stringify(part.input, null, 2)}</pre>
        {part.result && (
          <>
            <div className="tool-label">{part.result.error ? 'error' : 'output'}</div>
            <pre>{fmtOutput(part.result.output)}</pre>
          </>
        )}
      </div>
    </details>
  )
}

export function TurnView({ turn }: { turn: AssistantTurn }) {
  const tools = turn.parts.filter(p => p.kind === 'tool').length
  const last = turn.parts[turn.parts.length - 1]
  const working = turn.state === 'streaming' && last?.kind !== 'text'
  return (
    <li className="as-turn">
      <div className="as-user"><div className="as-bubble">{turn.question}</div></div>
      <div className="as-answer">
        {turn.notice && <p className="as-meta">{turn.notice}</p>}
        {turn.parts.map((p, i) => (p.kind === 'text' ? <Markdown key={i} text={p.text} /> : <ToolCall key={p.id} part={p} />))}
        {working && <p className="as-meta as-working">{turn.status ?? (tools ? 'Looking into it…' : 'Thinking…')}</p>}
        {turn.state === 'error' && <p className="as-error">{turn.error}</p>}
        {turn.done && (
          <p className="as-meta">
            {(turn.done.duration_ms / 1000).toFixed(0)}s · {tools} {tools === 1 ? 'tool call' : 'tool calls'}
            {!turn.done.ok && ` · stopped: ${turn.done.reason ?? ''}`}
          </p>
        )}
      </div>
    </li>
  )
}

function Composer({ value, onChange, onSubmit, onStop, busy }: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  busy: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = ''
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit() }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit() }
  }
  return (
    <form className="as-composer" onSubmit={submit}>
      <textarea ref={ref} rows={1} placeholder="Ask about your tasks, money, health, mail or the market" value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} aria-label="Message" />
      {busy ? (
        <button type="button" className="as-send" onClick={onStop} aria-label="Stop" title="Stop"><Icon name="stop" /></button>
      ) : (
        <button type="submit" className="as-send" disabled={!value.trim()} aria-label="Send" title="Send"><Icon name="send" /></button>
      )}
    </form>
  )
}

// The standing notes the assistant reads before every market check.
function MemoryDialog({ onClose, onError }: { onClose: () => void; onError: (err: unknown) => void }) {
  const [body, setBody] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api.assistant.getMemory(MEMORY_KEY).then(m => setBody(m.body), err => { onError(err); onClose() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const save = async () => {
    if (body == null) return
    setSaving(true)
    try { await api.assistant.setMemory(MEMORY_KEY, body); onClose() } catch (err) { onError(err) } finally { setSaving(false) }
  }
  return (
    <Dialog
      title="Portfolio notes"
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || !body?.trim()}>Save</button>
      </>}
    >
      <p className="modal-lead">Targets, buy triggers and skip conditions the Monday market check follows. Markdown.</p>
      {body == null ? <Loading rows={6} /> : <textarea className="field-input as-memory" value={body} onChange={e => setBody(e.target.value)} spellCheck={false} />}
    </Dialog>
  )
}

interface AssistantViewProps {
  isAuth: boolean
  initialChatId: string | null
}

// Chat with the operator's personal profile: tasks, money, health, mail, news
// and the market. Same passkey step-up as Assets and Health (it reads both),
// so nothing is requested until unlocked and a lock drops everything fetched.
// The server owns each turn: leaving the page does not stop an answer, and a
// finished weekly recap or market check is just another conversation here.
// The conversation itself lives in assistantStore, shared with the chat button.
export default function AssistantView({ isAuth, initialChatId }: AssistantViewProps) {
  const [masked, setMasked] = useState(false)
  const [input, setInput] = useState('')
  const [sidebar, setSidebar] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const { chat, list, live, loading: loadingChat, error: chatError } = useSyncExternalStore(assistantStore.subscribe, assistantStore.get)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingOpen = useRef(initialChatId)

  const onLock = () => { setMasked(false); setInput('') }
  const { unlocked, busy: unlocking, error: unlockError, remaining, lock, unlock } = useStepUp('assistant', isAuth, onLock)
  const error = unlockError ?? chatError

  const busy = live != null
  const remoteStreaming = isRemoteStreaming({ chat, list, live, loading: loadingChat, error: chatError })

  // Unlocked: load the list, and the conversation a push notification pointed at.
  useEffect(() => {
    if (!unlocked) return
    void refreshList()
    if (pendingOpen.current) {
      const id = pendingOpen.current
      pendingOpen.current = null
      void open(id)
    }
  }, [unlocked])

  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [chat.turns])

  const send = (q: string) => { setInput(''); void ask(q) }
  const openChat = (id: string) => { setSidebar(false); void open(id) }
  const newChat = () => { startNew(); setSidebar(false); setInput('') }
  const removeChat = async (c: AssistantSummary) => {
    if (!await confirmDialog({ title: 'Delete conversation', body: c.title, confirmLabel: 'Delete', danger: true })) return
    await remove(c.id)
  }

  const composer = <Composer value={input} onChange={setInput} onSubmit={() => send(input)} onStop={stop} busy={busy || remoteStreaming} />

  return (
    <div className="assistant-view">
      <StepUpBar unlocked={unlocked} busy={unlocking} remaining={remaining} masked={masked} onToggleMask={() => setMasked(m => !m)} onUnlock={unlock} onLock={lock} />
      {error && <p className="assets-error" onClick={() => setStoreError(null)}>{error}</p>}
      {!unlocked ? (
        <Empty icon="assistant" title="Assistant is locked" hint="Unlock with your passkey to ask about your tasks, money, health, mail and the market. Reports from the weekly recap and the Monday market check appear here too." />
      ) : (
        <div className={`split-view as-split${sidebar ? ' as-sidebar-open' : ''}${masked ? ' as-masked' : ''}`}>
          <aside className="split-sidebar as-sidebar" aria-label="Conversations">
            <div className="as-sidebar-actions">
              <button className="btn-ghost btn-sm" onClick={newChat}><Icon name="plus" size={14} /> New chat</button>
              <button className="btn-ghost btn-sm" onClick={() => setMemoryOpen(true)} title="Edit the portfolio notes the market check follows"><Icon name="note" size={14} /> Notes</button>
            </div>
            <ul className="as-history">
              {list === null && <li className="as-meta as-history-empty">Loading…</li>}
              {list?.length === 0 && <li className="as-meta as-history-empty">No conversations yet</li>}
              {list?.map(c => (
                <li key={c.id} className={c.id === chat.id ? 'active' : undefined}>
                  <button className="as-history-item" onClick={() => openChat(c.id)} title={c.title}>
                    {c.streaming && <span className="as-live-dot" aria-label="answering" />}
                    {c.title}
                  </button>
                  <button className="as-history-delete" onClick={() => removeChat(c)} aria-label={`Delete ${c.title}`} title="Delete"><Icon name="trash" size={14} /></button>
                </li>
              ))}
            </ul>
          </aside>
          {sidebar && <div className="as-scrim" onClick={() => setSidebar(false)} />}

          <section className="as-main">
            <div className="as-topbar">
              <button className="icon-btn as-menu" onClick={() => setSidebar(true)} aria-label="Conversations"><Icon name="sidebar" /></button>
              <span className="as-topbar-title">{chat.turns.length ? chat.title : 'Assistant'}</span>
            </div>
            {loadingChat ? (
              <div className="as-scroll"><Loading rows={5} /></div>
            ) : chat.turns.length === 0 ? (
              <div className="as-empty">
                <Icon name="assistant" size={28} className="empty-icon" />
                <h1>What do you want to know?</h1>
                <p className="as-meta">Tasks, events and goals, spending and assets, health, mail, news and the market. Read-only: I never change anything.</p>
                <div className="as-empty-composer">{composer}</div>
                <div className="as-suggestions">
                  {SUGGESTIONS.map(s => <button key={s} className="as-suggestion" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            ) : (
              <>
                <div className="as-scroll" ref={scrollRef}>
                  <ol className="as-thread">{chat.turns.map(t => <TurnView key={t.id} turn={t} />)}</ol>
                </div>
                <div className="as-dock">
                  {composer}
                  <p className="as-meta as-hint">{remoteStreaming ? 'Answering in the background · this view follows it' : 'Enter to send · shift+enter for a new line'}</p>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {memoryOpen && <MemoryDialog onClose={() => setMemoryOpen(false)} onError={err => setStoreError(err instanceof Error ? err.message : String(err))} />}
    </div>
  )
}
