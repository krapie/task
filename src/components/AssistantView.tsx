import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import { confirmDialog } from '../lib/notify'
import { ask, assistantStore, isRemoteStreaming, moveChat, open, refreshList, remove, setError as setStoreError, startNew, stop } from '../lib/assistantStore'
import StepUpBar from './StepUpBar'
import { Icon } from './Icons'
import { Dialog, Empty, Loading } from './Ui'
import { Markdown } from './Markdown'
import type { AssistantFolder, AssistantNoteSummary, AssistantPart, AssistantSummary, AssistantTurn } from '../types'

const PROTECTED_NOTE = 'portfolio' // read by the Monday market check; cannot be deleted

export const FOLDERS: { id: AssistantFolder; label: string }[] = [
  { id: 'summaries', label: 'Summaries' },
  { id: 'markets', label: 'Markets' },
  { id: 'money', label: 'Money' },
  { id: 'health', label: 'Health' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'mail', label: 'Mail' },
  { id: 'life', label: 'Life' },
  { id: 'other', label: 'Other' },
]

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 240
const isPhone = () => window.matchMedia('(max-width: 600px)').matches

// localStorage is a per-viewer convenience: it can be missing or throw, and the view works without it.
function readStore(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

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

// A change the assistant drafted for one of the owner's notes. Nothing is saved
// until Apply; the full text comes from the tool input (the stored result is clipped).
function NoteProposal({ part }: { part: Extract<AssistantPart, { kind: 'tool' }> }) {
  const input = part.input as { key?: string; title: string; body: string; summary: string }
  let base: string | null = null
  try { base = (JSON.parse(part.result?.output ?? '') as { base_updated_at: string | null }).base_updated_at } catch { /* shown as new */ }
  const doneKey = `kp-note-applied:${part.id}`
  const [state, setState] = useState<'idle' | 'applying' | 'applied' | 'dismissed' | 'outdated'>(() => (readStore(doneKey) ? 'applied' : 'idle'))
  const [error, setError] = useState<string | null>(null)

  // After a reload, a change to an existing note counts as applied when the note already holds this text.
  useEffect(() => {
    if (state !== 'idle' || !input.key || !api.assets.hasToken()) return
    api.assistant.getNote(input.key).then(n => {
      if (n.body === input.body) setState('applied')
      else if (n.updated_at !== base) setState('outdated')
    }, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = async () => {
    setState('applying')
    setError(null)
    try {
      let key = input.key
      if (key) await api.assistant.saveNote(key, { title: input.title, body: input.body, base_updated_at: base })
      else key = (await api.assistant.createNote(input.title, input.body)).key
      writeStore(doneKey, key)
      setState('applied')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/changed since/i.test(msg)) setState('outdated')
      else { setState('idle'); setError(msg) }
    }
  }

  return (
    <div className="as-proposal">
      <div className="as-proposal-head">
        <Icon name="note" size={14} />
        <span className="as-proposal-kind">{input.key ? 'Change to note' : 'New note'}</span>
        <span className="as-proposal-title">{input.title}</span>
      </div>
      <p className="as-proposal-summary">{input.summary}</p>
      <details className="as-proposal-body">
        <summary>Proposed text</summary>
        <pre>{input.body}</pre>
      </details>
      {error && <p className="as-error">{error}</p>}
      <div className="as-proposal-actions">
        {state === 'applied' && <span className="as-meta">Applied</span>}
        {state === 'dismissed' && <span className="as-meta">Dismissed</span>}
        {state === 'outdated' && <span className="as-meta">Outdated: the note changed since this was drafted. Ask again for a fresh draft.</span>}
        {(state === 'idle' || state === 'applying') && (
          <>
            <button type="button" className="btn-primary btn-sm" onClick={apply} disabled={state === 'applying'}>Apply</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setState('dismissed')} disabled={state === 'applying'}>Dismiss</button>
          </>
        )}
      </div>
    </div>
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
        {turn.parts.map((p, i) => {
          if (p.kind === 'text') return <Markdown key={i} text={p.text} />
          if (p.name.endsWith('propose_note') && p.result && !p.result.error) return <NoteProposal key={p.id} part={p} />
          return <ToolCall key={p.id} part={p} />
        })}
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

// The owner's standing notes: several, edited here, read by the assistant, which
// can only propose changes (see NoteProposal).
function NotesDialog({ onClose, onError }: { onClose: () => void; onError: (err: unknown) => void }) {
  const [list, setList] = useState<AssistantNoteSummary[] | null>(null)
  const [sel, setSel] = useState<string | null>(null) // note key, 'new', or null
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false) // phones: the editor replaces the list
  const [error, setError] = useState<string | null>(null)

  const pick = async (key: string, show = true) => {
    setSel(key)
    setEditing(show)
    setError(null)
    setLoading(true)
    try {
      const n = await api.assistant.getNote(key)
      setTitle(n.title)
      setBody(n.body)
      setBase(n.updated_at)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    api.assistant.listNotes().then(l => { setList(l); if (l[0]) void pick(l[0].key, false) }, err => { onError(err); onClose() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startNew = () => { setSel('new'); setTitle(''); setBody(''); setBase(null); setError(null); setEditing(true) }
  const save = async () => {
    if (!sel) return
    setSaving(true)
    setError(null)
    try {
      if (sel === 'new') {
        const created = await api.assistant.createNote(title.trim(), body)
        setSel(created.key)
        setBase(created.updated_at)
      } else {
        const saved = await api.assistant.saveNote(sel, { title: title.trim(), body, base_updated_at: base })
        setBase(saved.updated_at)
      }
      setList(await api.assistant.listNotes())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  const del = async () => {
    if (!sel || sel === 'new' || sel === PROTECTED_NOTE) return
    if (!await confirmDialog({ title: 'Delete note', body: title, confirmLabel: 'Delete', danger: true })) return
    try {
      await api.assistant.deleteNote(sel)
      const l = await api.assistant.listNotes()
      setList(l)
      setEditing(false)
      if (l[0]) await pick(l[0].key, false)
      else { setSel(null); setTitle(''); setBody('') }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const canSave = !!sel && !saving && !loading && !!title.trim() && !!body.trim()
  return (
    <Dialog
      title="Notes"
      className="as-notes-modal"
      onClose={onClose}
      footer={<>
        {sel && sel !== 'new' && sel !== PROTECTED_NOTE && <button type="button" className="btn-ghost as-notes-delete" onClick={del}>Delete</button>}
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        <button type="button" className="btn-primary" onClick={save} disabled={!canSave}>Save</button>
      </>}
    >
      <p className="modal-lead">Standing notes the assistant reads. It can draft changes, but they only apply when you press Apply. Markdown.</p>
      {list == null ? <Loading rows={6} /> : (
        <div className={`as-notes${editing ? ' as-notes-editing' : ''}`}>
          <div className="as-notes-list">
            <button type="button" className="btn-ghost btn-sm" onClick={startNew}><Icon name="plus" size={14} /> New note</button>
            <ul>
              {list.map(n => (
                <li key={n.key} className={n.key === sel ? 'active' : undefined}>
                  <button type="button" onClick={() => void pick(n.key)} title={n.title}>{n.title}</button>
                </li>
              ))}
              {list.length === 0 && sel !== 'new' && <li className="as-meta as-history-empty">No notes yet</li>}
            </ul>
          </div>
          <div className="as-notes-editor">
            {sel == null ? <p className="as-meta">Select a note or create one.</p> : (
              <>
                <button type="button" className="btn-ghost btn-sm as-notes-back" onClick={() => setEditing(false)}>Back to notes</button>
                <input className="field-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" maxLength={80} aria-label="Title" />
                {loading ? <Loading rows={6} /> : <textarea className="field-input as-memory" value={body} onChange={e => setBody(e.target.value)} spellCheck={false} aria-label="Note" />}
                {error && <p className="as-error">{error}</p>}
              </>
            )}
          </div>
        </div>
      )}
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
  const [sbWidth, setSbWidth] = useState(() => {
    const n = Number(readStore('kp-as-sidebar-w'))
    return Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT
  })
  const [sbHidden, setSbHidden] = useState(() => readStore('kp-as-sidebar-hidden') === '1')
  const [dragging, setDragging] = useState(false)
  const [closedFolders, setClosedFolders] = useState<string[]>(() => {
    try { const v = JSON.parse(readStore('kp-as-folders-closed') ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
  })
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

  const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
  const resizeTo = (w: number) => { const v = clampWidth(w); setSbWidth(v); writeStore('kp-as-sidebar-w', String(v)) }
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    const startX = e.clientX
    const startW = sbWidth
    el.setPointerCapture(e.pointerId)
    setDragging(true)
    const move = (ev: PointerEvent) => setSbWidth(clampWidth(startW + ev.clientX - startX))
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDragging(false)
      resizeTo(startW + ev.clientX - startX)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onResizerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); resizeTo(sbWidth - 16) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); resizeTo(sbWidth + 16) }
    else if (e.key === 'Home') { e.preventDefault(); resizeTo(SIDEBAR_DEFAULT) }
  }
  // Phones: the sidebar is a drawer, so closing it only hides the drawer. Desktop: collapse it, remembered.
  const closeSidebar = () => {
    setSidebar(false)
    if (!isPhone()) { setSbHidden(true); writeStore('kp-as-sidebar-hidden', '1') }
  }
  const openSidebar = () => {
    setSidebar(true)
    setSbHidden(false)
    writeStore('kp-as-sidebar-hidden', '0')
  }
  const toggleFolder = (id: string) => {
    const next = closedFolders.includes(id) ? closedFolders.filter(f => f !== id) : [...closedFolders, id]
    setClosedFolders(next)
    writeStore('kp-as-folders-closed', JSON.stringify(next))
  }
  const groups = FOLDERS.map(f => ({ ...f, items: (list ?? []).filter(c => (c.folder ?? 'other') === f.id) })).filter(g => g.items.length > 0)
  const currentFolder: AssistantFolder = list?.find(c => c.id === chat.id)?.folder ?? 'other'

  const composer = <Composer value={input} onChange={setInput} onSubmit={() => send(input)} onStop={stop} busy={busy || remoteStreaming} />

  return (
    <div className="assistant-view">
      <StepUpBar unlocked={unlocked} busy={unlocking} remaining={remaining} masked={masked} onToggleMask={() => setMasked(m => !m)} onUnlock={unlock} onLock={lock} />
      {error && <p className="assets-error" onClick={() => setStoreError(null)}>{error}</p>}
      {!unlocked ? (
        <Empty icon="assistant" title="Assistant is locked" hint="Unlock with your passkey to ask about your tasks, money, health, mail and the market. Reports from the weekly recap and the Monday market check appear here too." />
      ) : (
        <div className={`split-view as-split${sidebar ? ' as-sidebar-open' : ''}${sbHidden ? ' as-collapsed' : ''}${dragging ? ' as-dragging' : ''}${masked ? ' as-masked' : ''}`} style={{ '--as-sidebar-w': `${sbWidth}px` } as CSSProperties}>
          <aside className="split-sidebar as-sidebar" aria-label="Conversations">
            <div className="as-sidebar-actions">
              <button className="btn-ghost btn-sm" onClick={newChat}><Icon name="plus" size={14} /> New chat</button>
              <button className="btn-ghost btn-sm" onClick={() => setMemoryOpen(true)} title="Notes the assistant reads and can propose changes to"><Icon name="note" size={14} /> Notes</button>
              <button className="icon-btn as-sidebar-close" onClick={closeSidebar} aria-label="Close sidebar" title="Close sidebar"><Icon name="close" size={16} /></button>
            </div>
            <ul className="as-history">
              {list === null && <li className="as-meta as-history-empty">Loading…</li>}
              {list?.length === 0 && <li className="as-meta as-history-empty">No conversations yet</li>}
              {groups.map(g => {
                const open = !closedFolders.includes(g.id)
                return [
                  <li key={`folder-${g.id}`} className="as-folder">
                    <button className="as-folder-head" onClick={() => toggleFolder(g.id)} aria-expanded={open}>
                      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
                      <span>{g.label}</span>
                      <span className="as-folder-count">{g.items.length}</span>
                    </button>
                  </li>,
                  ...(open ? g.items.map(c => (
                    <li key={c.id} className={`as-chat${c.id === chat.id ? ' active' : ''}`}>
                      <button className="as-history-item" onClick={() => openChat(c.id)} title={c.title}>
                        {c.streaming && <span className="as-live-dot" aria-label="answering" />}
                        {c.title}
                      </button>
                      <button className="as-history-delete" onClick={() => removeChat(c)} aria-label={`Delete ${c.title}`} title="Delete"><Icon name="trash" size={14} /></button>
                    </li>
                  )) : []),
                ]
              })}
            </ul>
          </aside>
          <div
            className="as-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize conversation list"
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            aria-valuenow={sbWidth}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={onResizerKey}
            onDoubleClick={() => resizeTo(SIDEBAR_DEFAULT)}
          />
          {sidebar && <div className="as-scrim" onClick={() => setSidebar(false)} />}

          <section className="as-main">
            <div className="as-topbar">
              <button className="icon-btn as-menu" onClick={openSidebar} aria-label="Show conversations" title="Show conversations"><Icon name="sidebar" /></button>
              <span className="as-topbar-title">{chat.turns.length ? chat.title : 'Assistant'}</span>
              {chat.id && (
                <label className="as-move">
                  <span className="as-meta">Folder</span>
                  <select className="as-move-select" value={currentFolder} onChange={e => void moveChat(chat.id!, e.target.value as AssistantFolder)} aria-label="Move to folder">
                    {FOLDERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </label>
              )}
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
      {memoryOpen && <NotesDialog onClose={() => setMemoryOpen(false)} onError={err => setStoreError(err instanceof Error ? err.message : String(err))} />}
    </div>
  )
}
