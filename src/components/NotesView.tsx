import { Suspense, lazy, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import { confirmDialog } from '../lib/notify'
import StepUpBar from './StepUpBar'
import { Icon } from './Icons'
import { Loading } from './Ui'
import type { NoteSummary } from '../types'

// The editor (CodeMirror) is only downloaded when the Notes tab opens.
const MarkdownEditor = lazy(() => import('./MarkdownEditor'))

const SEARCH_DELAY_MS = 250
const AUTOSAVE_MS = 1500 // a pause in typing this long saves the note

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

interface NotesViewProps {
  isAuth: boolean
  onAskAbout: (title: string) => void
}

interface Saved { title: string; body: string; hidden: boolean }
const NOTHING_SAVED: Saved = { title: '', body: '', hidden: false }

// The owner's notes. Notes that are not hidden need no passkey; hidden ones appear only while unlocked with the
// passkey (same step-up as Chats, and a lock drops them). Edits are saved by themselves after a pause in typing,
// when leaving a note and when the tab locks. The assistant searches and reads notes (notes_search / note_get)
// and can only propose changes, which are applied from a card in Chats.
export default function NotesView({ isAuth, onAskAbout }: NotesViewProps) {
  const [masked, setMasked] = useState(false)
  const [list, setList] = useState<NoteSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null) // note key, 'new', or null
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [hidden, setHidden] = useState(false)
  const [saved, setSaved] = useState<Saved>(NOTHING_SAVED) // what the server holds, to tell unsaved edits
  const [base, setBase] = useState<string | null>(null)
  const [docId, setDocId] = useState(0) // new editor instance (cursor, undo history) per opened note
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [conflict, setConflict] = useState(false) // the note changed elsewhere: autosave stops until it is reopened
  const [editing, setEditing] = useState(false) // phones: the editor replaces the list
  const [error, setError] = useState<string | null>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  // The save runs outside React's render cycle (a queue, and one last request while locking), so it reads the
  // latest values from here and writes its results here too, before the state catches up.
  const cur = useRef({ sel, title, body, hidden, saved, base, loading, conflict, docId })
  cur.current = { sel, title, body, hidden, saved, base, loading, conflict, docId }
  const inflight = useRef<Promise<boolean> | null>(null)

  const dropOpenNote = () => { setSel(null); setTitle(''); setBody(''); setHidden(false); setSaved(NOTHING_SAVED); setBase(null); setDocId(n => n + 1); setEditing(false); setConflict(false); setSaveFailed(false) }

  // Locked: hidden notes leave the list and the editor; a visible note stays open.
  const onLock = () => {
    setMasked(false)
    setList(l => l?.filter(n => !n.hidden) ?? null)
    if (cur.current.hidden || cur.current.saved.hidden) dropOpenNote()
  }
  const flushRef = useRef<() => void>(() => {})
  const { unlocked, busy: unlocking, error: unlockError, remaining, lock, unlock } = useStepUp('assistant', isAuth, onLock, undefined, () => flushRef.current())

  const fail = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'ASSET_SESSION_EXPIRED') { api.assets.clearToken(); lock(); return }
    setError(msg)
  }, [lock])

  const trimmed = title.trim()
  const dirty = sel != null && (trimmed !== saved.title || body !== saved.body || hidden !== saved.hidden)
  const saveable = !!trimmed && !!body.trim()

  // An answer is dropped when a newer request was made, or when the lock changed while it travelled (an answer
  // fetched with the passkey must not put hidden notes back on a locked screen; the lock change reloads).
  const loadSeq = useRef(0)
  const load = useCallback(async (q: string) => {
    const seq = ++loadSeq.current
    const wasUnlocked = api.assets.hasToken()
    try {
      const rows = await api.notes.list(q)
      if (seq === loadSeq.current && api.assets.hasToken() === wasUnlocked) setList(rows)
    } catch (err) { if (seq === loadSeq.current) fail(err) }
  }, [fail])

  // Signed in: load the list (again after an unlock or a lock); typing in the search box re-queries the server after a pause.
  useEffect(() => {
    if (!isAuth) return
    const t = setTimeout(() => void load(query), query ? SEARCH_DELAY_MS : 0)
    return () => clearTimeout(t)
  }, [isAuth, unlocked, query, load])

  // One save at a time, in order. The request starts in the same tick when nothing else is running: the lock
  // relies on that (the token is cleared right after the flush).
  const saveNow = useCallback((): Promise<boolean> => {
    const auth = api.notes.auth() // taken now: a save queued behind another still goes out with this token
    const run = async (): Promise<boolean> => {
      const c = cur.current
      const t = c.title.trim()
      if (!c.sel || c.loading || c.conflict) return false
      const isNew = c.sel === 'new'
      if (!isNew && t === c.saved.title && c.body === c.saved.body && c.hidden === c.saved.hidden) return true
      if (!t || !c.body.trim()) return false
      const snap: Saved = { title: t, body: c.body, hidden: c.hidden }
      const started = c.docId
      setSaving(true)
      setError(null)
      try {
        let key = c.sel
        let updatedAt: string
        if (isNew) {
          const created = await api.notes.create(t, c.body, c.hidden, auth)
          key = created.key
          updatedAt = created.updated_at
        } else {
          const res = await api.notes.save(c.sel, { title: t, body: c.body, base_updated_at: c.base, ...(c.hidden !== c.saved.hidden ? { hidden: c.hidden } : {}) }, auth)
          updatedAt = res.updated_at
        }
        if (cur.current.docId === started) {
          cur.current = { ...cur.current, sel: key, base: updatedAt, saved: snap }
          setSel(key); setBase(updatedAt); setSaved(snap)
        }
        setSaveFailed(false)
        await load(queryRef.current)
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/changed since/i.test(msg)) {
          if (cur.current.docId === started) { cur.current = { ...cur.current, conflict: true }; setConflict(true) }
          setError('This note changed somewhere else (the assistant\'s Apply or another tab). Autosave stopped: copy your text, reopen the note and paste it back.')
        } else {
          setSaveFailed(true)
          fail(err)
        }
        return false
      } finally {
        setSaving(false)
      }
    }
    const p = inflight.current ? inflight.current.then(run, run) : run()
    inflight.current = p
    void p.finally(() => { if (inflight.current === p) inflight.current = null })
    return p
  }, [load, fail])
  flushRef.current = () => { if (cur.current.sel && !cur.current.conflict) void saveNow() }

  // Autosave: a pause in typing saves; hiding or unhiding a note saves at once.
  useEffect(() => {
    if (!sel || loading || !dirty || !saveable || conflict) return
    const t = setTimeout(() => void saveNow(), hidden !== saved.hidden ? 0 : AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [sel, title, body, hidden, saved, loading, dirty, saveable, conflict, saveNow])

  // Before opening another note: save what is open; ask only when that is not possible.
  const leave = async () => {
    if (!dirty) return true
    if (await saveNow()) return true
    return confirmDialog({ title: 'Discard changes', body: 'This note has changes that could not be saved.', confirmLabel: 'Discard', danger: true })
  }

  const pick = async (key: string) => {
    if (key === sel) { setEditing(true); return }
    if (!await leave()) return
    setSel(key)
    setEditing(true)
    setDocId(n => n + 1)
    setError(null)
    setConflict(false)
    setSaveFailed(false)
    setLoading(true)
    try {
      const n = await api.notes.get(key)
      setTitle(n.title)
      setBody(n.body)
      setHidden(n.hidden)
      setSaved({ title: n.title, body: n.body, hidden: n.hidden })
      setBase(n.updated_at)
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  const startNew = async () => {
    if (!await leave()) return
    setSel('new'); setTitle(''); setBody(''); setHidden(false); setSaved(NOTHING_SAVED); setBase(null); setDocId(n => n + 1); setError(null); setConflict(false); setSaveFailed(false); setEditing(true)
  }

  const del = async () => {
    if (!sel || sel === 'new') return
    if (!await confirmDialog({ title: 'Delete note', body: title, confirmLabel: 'Delete', danger: true })) return
    try {
      await api.notes.remove(sel)
      dropOpenNote()
      await load(queryRef.current)
    } catch (err) {
      fail(err)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void saveNow() }
  }

  // Edits not saved yet are lost on a reload or tab close, so say so.
  const pending = dirty || saving
  useEffect(() => {
    if (!pending) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [pending])

  const error_ = unlockError ?? error
  const canSave = !!sel && !saving && !loading && saveable && !conflict && (dirty || sel === 'new')
  const state = saving ? 'Saving…' : conflict ? 'Not saved' : saveFailed && dirty ? 'Not saved' : dirty ? 'Unsaved changes' : sel === 'new' ? '' : 'Saved'

  return (
    <div className="assistant-view notes-view">
      <StepUpBar unlocked={unlocked} busy={unlocking} remaining={remaining} masked={masked} onToggleMask={() => setMasked(m => !m)} onUnlock={unlock} onLock={lock} />
      {error_ && <p className="assets-error" onClick={() => setError(null)}>{error_}</p>}
      <div className={`notes-split${editing ? ' notes-editing' : ''}${masked ? ' notes-masked' : ''}`} onKeyDown={onKeyDown}>
        <aside className="notes-side" aria-label="Notes">
          <div className="notes-side-head">
            <input
              className="field-input"
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
            />
            <button type="button" className="btn-ghost btn-sm" onClick={() => void startNew()}><Icon name="plus" size={14} /> New note</button>
          </div>
          {list == null ? <Loading rows={5} /> : (
            <ul className="notes-list">
              {sel === 'new' && <li className="active"><button type="button"><span className="notes-item-title">{trimmed || 'Untitled'}</span><span className="as-meta">{saving ? 'Saving…' : 'Not saved'}</span></button></li>}
              {list.map(n => (
                <li key={n.key} className={n.key === sel ? 'active' : undefined}>
                  <button type="button" onClick={() => void pick(n.key)} title={n.title}>
                    <span className="notes-item-title">{n.hidden && <Icon name="lock" size={12} className="notes-item-lock" />}{n.title}</span>
                    <span className="as-meta notes-item-date">{fmtDate(n.updated_at)}</span>
                    {n.snippet && <span className="as-meta notes-item-snippet">{n.snippet}</span>}
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="as-meta as-history-empty">{query ? 'No notes match' : 'No notes yet'}</li>}
              {!unlocked && <li className="as-meta as-history-empty">Hidden notes appear after you unlock with your passkey.</li>}
            </ul>
          )}
        </aside>

        <section className="notes-main">
          {sel == null ? (
            <div className="as-empty">
              <Icon name="note" size={28} className="empty-icon" />
              <h1>Write something down</h1>
              <p className="as-meta">Plans, preferences, things to remember. Notes are saved as you type. The assistant searches your notes when a question touches them, and can draft changes that you apply.</p>
              <button type="button" className="btn-primary" onClick={() => void startNew()}><Icon name="plus" size={14} /> New note</button>
            </div>
          ) : (
            <>
              <div className="notes-bar">
                <button type="button" className="btn-ghost btn-sm notes-back" onClick={() => void leave().then(ok => { if (ok) setEditing(false) })}>Back to notes</button>
                <input className="field-input notes-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" maxLength={80} aria-label="Title" />
              </div>
              {loading ? <Loading rows={8} /> : (
                <Suspense fallback={<Loading rows={8} />}>
                  <MarkdownEditor key={docId} value={body} onChange={setBody} />
                </Suspense>
              )}
              <div className="notes-foot">
                {sel !== 'new' && <button type="button" className="btn-ghost notes-delete" onClick={() => void del()}>Delete</button>}
                {unlocked && <button type="button" className="btn-ghost" onClick={() => setHidden(h => !h)} aria-pressed={hidden} title={hidden ? 'Show this note without the passkey' : 'Only show this note after the passkey'}><Icon name="lock" size={14} /> {hidden ? 'Unhide' : 'Hide'}</button>}
                <span className="as-meta notes-state">{state}</span>
                {sel !== 'new' && <button type="button" className="btn-ghost" onClick={() => onAskAbout(title)} title="Start a chat about this note"><Icon name="assistant" size={14} /> Ask about this note</button>}
                <button type="button" className="btn-primary" onClick={() => void saveNow()} disabled={!canSave}>Save</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
