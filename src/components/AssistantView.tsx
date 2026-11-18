import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import { confirmDialog } from '../lib/notify'
import { useEscToStop } from '../lib/useEscToStop'
import { ask, assistantStore, isRemoteStreaming, moveChat, open, refreshList, remove, setChatProfile, setChoice, setError as setStoreError, startNew, stop } from '../lib/assistantStore'
import { ActionCard, ApprovalCard, BrowserPanel, SiteProposal, isApprovalTool, isWriteTool } from './AssistantCards'
import StepUpBar from './StepUpBar'
import { Icon } from './Icons'
import { Empty, Loading } from './Ui'
import { Markdown } from './Markdown'
import type { AssistantChoice, AssistantFolder, AssistantPart, AssistantProfile, AssistantSummary, AssistantTurn } from '../types'

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
const SIDEBAR_DEFAULT = 280
// The browser panel: dragged by its left edge, remembered; from BR_WIDE_AT up the conversation list folds away.
const BR_MIN = 320
const BR_DEFAULT = 400
const BR_WIDE_AT = 560
const BR_CHAT_MIN = 300
const isPhone = () => window.matchMedia('(max-width: 600px)').matches

// localStorage is a per-viewer convenience: it can be missing or throw, and the view works without it.
function readStore(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

// Two of each kind: the question decides which agent answers (assistant: acts, mail, browser; personal: money, health, notes).
export const SUGGESTIONS = [
  'Add an event today at 15:00: dentist',
  'Any unread mail that needs a reply?',
  'How much did I spend this month, by category?',
  'How did I sleep and train this week?',
]
export const PROFILE_LABELS: Record<AssistantProfile, string> = { assistant: 'Assistant', personal: 'Personal' }
export const PROFILE_HINTS: Record<AssistantProfile, string> = {
  assistant: 'Does things: tasks, mail, browser. Cannot see your money, health or notes.',
  personal: 'Reads private data: money, health, notes. Read-only: no mail, no browser.',
}

// Which agent holds a chat, shown on each conversation and in the chat's header.
export function ProfileBadge({ profile }: { profile: AssistantProfile | null | undefined }) {
  if (!profile) return null
  return <span className="as-badge" title={PROFILE_HINTS[profile]}>{PROFILE_LABELS[profile]}</span>
}

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
    api.notes.get(input.key).then(n => {
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
      if (key) await api.notes.save(key, { title: input.title, body: input.body, base_updated_at: base })
      else key = (await api.notes.create(input.title, input.body)).key
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

export function TurnView({ turn, onOpenBrowser }: { turn: AssistantTurn; onOpenBrowser?: () => void }) {
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
          if (p.name.endsWith('propose_site') && p.result && !p.result.error) return <SiteProposal key={p.id} part={p} />
          if (isWriteTool(p.name)) return <ActionCard key={p.id} part={p} />
          if (isApprovalTool(p.name)) return <ApprovalCard key={p.id} part={p} onOpenBrowser={onOpenBrowser} />
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

function Composer({ value, onChange, onSubmit, onStop, busy, placeholder }: {
  placeholder: string
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
      <textarea ref={ref} rows={1} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} aria-label="Message" />
      {busy ? (
        <button type="button" className="as-send" onClick={onStop} aria-label="Stop" title="Stop (Esc)"><Icon name="stop" /></button>
      ) : (
        <button type="submit" className="as-send" disabled={!value.trim()} aria-label="Send" title="Send"><Icon name="send" /></button>
      )}
    </form>
  )
}

interface AssistantViewProps {
  isAuth: boolean
  initialChatId: string | null
  onOpenNotes: () => void
  draft: string | null
  onDraftUsed: () => void
}

// The Assistant tab: one list of chats behind one passkey step-up; each chat is answered by one of two agents of
// the operator. "Assistant" does things (add events and todos, check mail, drive a browser for Coupang, Catch Table
// and 정부24, asking before it spends or submits). "Personal" reads private data (money, health, notes, the market).
// A new chat is routed by its first question (Auto), the owner can change the agent in the chat, and each chat shows
// a badge. The agents are not merged: the one that reads untrusted text has no private-data tool. The step-up is the
// same as Assets and Health, so nothing is requested until unlocked and a lock drops everything fetched.
// The server owns each turn: leaving the page does not stop an answer, and a
// finished market note is just another conversation here.
// The conversation itself lives in assistantStore, shared with the chat button.
export default function AssistantView({ isAuth, initialChatId, onOpenNotes, draft, onDraftUsed }: AssistantViewProps) {
  const [masked, setMasked] = useState(false)
  const [input, setInput] = useState('')
  const [sidebar, setSidebar] = useState(false)
  const [sbWidth, setSbWidth] = useState(() => {
    const n = Number(readStore('kp-as-sidebar-w'))
    return Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT
  })
  const [sbHidden, setSbHidden] = useState(() => readStore('kp-as-sidebar-hidden') === '1')
  const [brWidth, setBrWidth] = useState(() => {
    const n = Number(readStore('kp-as-browser-w'))
    return Number.isFinite(n) && n >= BR_MIN && n <= 4000 ? n : BR_DEFAULT
  })
  const [brDragging, setBrDragging] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const [, setWinTick] = useState(0) // a window resize re-clamps the browser width (the stored one is the owner's choice, not changed)
  useEffect(() => {
    const f = () => setWinTick(n => n + 1)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const [dragging, setDragging] = useState(false)
  const [closedFolders, setClosedFolders] = useState<string[]>(() => {
    try { const v = JSON.parse(readStore('kp-as-folders-closed') ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
  })
  const [browserOpen, setBrowserOpen] = useState(false)
  const { choice, chat, list, live, loading: loadingChat, error: chatError } = useSyncExternalStore(assistantStore.subscribe, assistantStore.get)
  // The agent of this chat, or of the next new chat when the owner picked one (null = Auto, not routed yet).
  const profile: AssistantProfile | null = chat.profile ?? (chat.id ? null : choice === 'auto' ? null : choice)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingOpen = useRef(initialChatId)

  const onLock = () => { setMasked(false); setInput('') }
  // The open conversation rides in the return address (#/note/chats/<id>), so the passkey prompt gives it back.
  const { unlocked, busy: unlocking, error: unlockError, remaining, lock, unlock } = useStepUp('assistant', isAuth, onLock, () => (chat.id ? `${location.origin}${location.pathname}#/assistant/${chat.id}` : undefined))
  const error = unlockError ?? chatError

  const busy = live != null
  const mainRef = useRef<HTMLElement>(null)
  const remoteStreaming = isRemoteStreaming({ choice, chat, list, live, loading: loadingChat, error: chatError })
  useEscToStop(unlocked && (busy || remoteStreaming), stop, mainRef) // Esc in the chat interrupts the agent; the browser panel keeps its own keys

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

  // A draft from the Notes tab ("Ask about this note") starts the composer.
  useEffect(() => {
    if (draft == null) return
    setInput(draft)
    onDraftUsed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

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

  // The browser panel keeps BR_CHAT_MIN for the chat; a window that shrank later is handled by the panel's max-width in CSS.
  const clampBr = (w: number) => Math.round(Math.max(BR_MIN, Math.min(w, (splitRef.current?.clientWidth ?? window.innerWidth) - BR_CHAT_MIN)))
  const resizeBr = (w: number) => { const v = clampBr(w); setBrWidth(v); writeStore('kp-as-browser-w', String(v)) }
  const brEff = clampBr(brWidth) // what fits now
  const toggleBrWide = () => resizeBr(brEff >= BR_WIDE_AT ? BR_DEFAULT : Math.min(1100, (splitRef.current?.clientWidth ?? 1200) - 340))
  const startBrDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    const startX = e.clientX
    const startW = brEff
    el.setPointerCapture(e.pointerId)
    setBrDragging(true)
    const move = (ev: PointerEvent) => setBrWidth(clampBr(startW + startX - ev.clientX)) // the panel is on the right: dragging left widens it
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setBrDragging(false)
      resizeBr(startW + startX - ev.clientX)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onBrKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); resizeBr(brEff + 16) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); resizeBr(brEff - 16) }
    else if (e.key === 'Home') { e.preventDefault(); resizeBr(BR_DEFAULT) }
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

  const composer = <Composer placeholder={profile === 'assistant' ? 'Ask me to do something: add an event, check mail, book a table' : profile === 'personal' ? 'Ask about your money, health, notes or the market' : 'Ask me to do something, or about your money, health, notes'} value={input} onChange={setInput} onSubmit={() => send(input)} onStop={stop} busy={busy || remoteStreaming} />

  return (
    <div className="assistant-view">
      <StepUpBar unlocked={unlocked} busy={unlocking} remaining={remaining} masked={masked} onToggleMask={() => setMasked(m => !m)} onUnlock={unlock} onLock={lock} />
      {error && <p className="assets-error" onClick={() => setStoreError(null)}>{error}</p>}
      {!unlocked ? (
        <Empty icon="assistant" title="Assistant is locked" hint="Unlock with your passkey. One chat list, two agents: Assistant adds events and todos, checks mail and uses a browser; Personal answers about money, health, notes and the market, and holds the Tuesday market note." />
      ) : (
        <div ref={splitRef} className={`split-view as-split${sidebar ? ' as-sidebar-open' : ''}${sbHidden ? ' as-collapsed' : ''}${dragging ? ' as-dragging' : ''}${brDragging ? ' br-dragging' : ''}${browserOpen && chat.profile === 'assistant' && brEff >= BR_WIDE_AT ? ' as-br-wide' : ''}${masked ? ' as-masked' : ''}`} style={{ '--as-sidebar-w': `${sbWidth}px`, '--br-w': `${brEff}px` } as CSSProperties}>
          <aside className="split-sidebar as-sidebar" aria-label="Conversations">
            <div className="as-sidebar-actions">
              <button className="btn-ghost btn-sm" onClick={newChat}><Icon name="plus" size={14} /> New chat</button>
              <button className="btn-ghost btn-sm" onClick={onOpenNotes} title="Your notes, which the Personal agent searches and can propose changes to"><Icon name="note" size={14} /> Notes</button>
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
                        <span className="as-history-title">{c.title}</span>
                        <ProfileBadge profile={c.profile} />
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

          <section className="as-main" ref={mainRef}>
            <div className="as-topbar">
              <button className="icon-btn as-menu" onClick={openSidebar} aria-label="Show conversations" title="Show conversations"><Icon name="sidebar" /></button>
              <span className="as-topbar-title">{chat.turns.length ? chat.title : ''}</span>
              <label className="as-move">
                <span className="as-meta">Agent</span>
                <select
                  className="as-move-select"
                  value={chat.id ? (chat.profile ?? '') : choice}
                  onChange={e => (chat.id ? void setChatProfile(e.target.value as AssistantProfile) : setChoice(e.target.value as AssistantChoice))}
                  disabled={busy || remoteStreaming}
                  aria-label="Agent"
                  title={chat.id ? 'Hand this chat to the other agent. The new agent only remembers what it answered itself, so private data never reaches the one that reads mail and the web.' : 'Auto picks the agent from your first question'}
                >
                  {chat.id ? (chat.profile ? null : <option value="" disabled>Choosing…</option>) : <option value="auto">Auto</option>}
                  <option value="assistant">Assistant</option>
                  <option value="personal">Personal</option>
                </select>
              </label>
              {chat.profile === 'assistant' && (
                <button className={`icon-btn${browserOpen ? ' icon-btn-active' : ''}`} onClick={() => setBrowserOpen(o => !o)} aria-label="Browser" aria-pressed={browserOpen} title="The assistant's browser: watch it, sign in, take over"><Icon name="globe" /></button>
              )}
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
                <h1>{profile === 'assistant' ? 'What should I do?' : profile === 'personal' ? 'What do you want to know?' : 'How can I help?'}</h1>
                <p className="as-meta">{profile === 'assistant'
                  ? 'I add events, todos and tasks, check your mail, and use a browser for Coupang, Catch Table and 정부24. I ask before I spend, book or submit anything.'
                  : profile === 'personal'
                    ? 'Spending and assets, health, your notes and the market. Read-only: I never change anything (use Assistant for that).'
                    : 'Ask me to do something (events, todos, mail, a browser) or about your money, health, notes and the market. The question picks the agent; you can change it in the chat.'}</p>
                <div className="as-empty-composer">{composer}</div>
                <div className="as-suggestions">
                  {SUGGESTIONS.map(s => <button key={s} className="as-suggestion" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            ) : (
              <>
                <div className="as-scroll" ref={scrollRef}>
                  <ol className="as-thread">{chat.turns.map(t => <TurnView key={t.id} turn={t} onOpenBrowser={chat.profile === 'assistant' ? () => setBrowserOpen(true) : undefined} />)}</ol>
                </div>
                <div className="as-dock">
                  {composer}
                  <p className="as-meta as-hint">{remoteStreaming ? 'Answering in the background · this view follows it · Esc to stop' : busy ? 'Esc to stop' : 'Enter to send · shift+enter for a new line'}</p>
                </div>
              </>
            )}
          </section>
          {browserOpen && chat.profile === 'assistant' && (
            <>
              <div
                className="br-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize browser"
                aria-valuemin={BR_MIN}
                aria-valuenow={brEff}
                tabIndex={0}
                onPointerDown={startBrDrag}
                onKeyDown={onBrKey}
                onDoubleClick={() => resizeBr(BR_DEFAULT)}
              />
              <BrowserPanel onClose={() => setBrowserOpen(false)} wide={brEff >= BR_WIDE_AT} onToggleWide={toggleBrWide} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
