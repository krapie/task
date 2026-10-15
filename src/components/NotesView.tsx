import { Suspense, lazy, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/notify'
import { Icon } from './Icons'
import { Loading } from './Ui'
import type { NoteSummary } from '../types'

// The editor (CodeMirror) is only downloaded when the Notes tab opens.
const MarkdownEditor = lazy(() => import('./MarkdownEditor'))

const PROTECTED_NOTE = 'portfolio' // read by the Monday market check; cannot be deleted
const SEARCH_DELAY_MS = 250

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

interface NotesViewProps {
  onAskAbout: (title: string) => void
}

// The owner's notes. The assistant searches and reads them (notes_search / note_get)
// and can only propose changes, which are applied from a card in Chats. Owner-only
// like Chats, but the normal session is enough: no passkey.
export default function NotesView({ onAskAbout }: NotesViewProps) {
  const [list, setList] = useState<NoteSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null) // note key, 'new', or null
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState({ title: '', body: '' }) // what the server holds, to tell unsaved edits
  const [base, setBase] = useState<string | null>(null)
  const [docId, setDocId] = useState(0) // new editor instance (cursor, undo history) per opened note
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false) // phones: the editor replaces the list
  const [error, setError] = useState<string | null>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  const dirty = sel != null && (title !== saved.title || body !== saved.body)

  const load = useCallback(async (q: string) => {
    try { setList(await api.notes.list(q)) } catch (err) { fail(err) }
  }, [fail])

  // Load the list; typing in the search box re-queries the server after a pause.
  useEffect(() => {
    const t = setTimeout(() => void load(query), query ? SEARCH_DELAY_MS : 0)
    return () => clearTimeout(t)
  }, [query, load])

  const confirmDiscard = async () => !dirty || await confirmDialog({ title: 'Discard changes', body: 'This note has unsaved changes.', confirmLabel: 'Discard', danger: true })

  const pick = async (key: string) => {
    if (key === sel) { setEditing(true); return }
    if (!await confirmDiscard()) return
    setSel(key)
    setEditing(true)
    setDocId(n => n + 1)
    setError(null)
    setLoading(true)
    try {
      const n = await api.notes.get(key)
      setTitle(n.title)
      setBody(n.body)
      setSaved({ title: n.title, body: n.body })
      setBase(n.updated_at)
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  const startNew = async () => {
    if (!await confirmDiscard()) return
    setSel('new'); setTitle(''); setBody(''); setSaved({ title: '', body: '' }); setBase(null); setDocId(n => n + 1); setError(null); setEditing(true)
  }

  const save = async () => {
    if (!sel || saving || loading || !title.trim() || !body.trim()) return
    setSaving(true)
    setError(null)
    try {
      const t = title.trim()
      if (sel === 'new') {
        const created = await api.notes.create(t, body)
        setSel(created.key)
        setBase(created.updated_at)
      } else {
        const res = await api.notes.save(sel, { title: t, body, base_updated_at: base })
        setBase(res.updated_at)
      }
      setTitle(t)
      setSaved({ title: t, body })
      await load(queryRef.current)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/changed since/i.test(msg)) setError('This note changed somewhere else (the assistant\'s Apply or another tab). Copy your text, reopen the note and paste it back.')
      else fail(err)
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!sel || sel === 'new' || sel === PROTECTED_NOTE) return
    if (!await confirmDialog({ title: 'Delete note', body: title, confirmLabel: 'Delete', danger: true })) return
    try {
      await api.notes.remove(sel)
      setSel(null); setTitle(''); setBody(''); setSaved({ title: '', body: '' }); setEditing(false)
      await load(queryRef.current)
    } catch (err) {
      fail(err)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save() }
  }

  // Unsaved edits are lost on a reload or tab close, so say so.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const canSave = !!sel && !saving && !loading && !!title.trim() && !!body.trim() && (dirty || sel === 'new')

  return (
    <div className="assistant-view notes-view">
      {error && <p className="assets-error" onClick={() => setError(null)}>{error}</p>}
      <div className={`notes-split${editing ? ' notes-editing' : ''}`} onKeyDown={onKeyDown}>
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
              {sel === 'new' && <li className="active"><button type="button"><span className="notes-item-title">{title.trim() || 'Untitled'}</span><span className="as-meta">Not saved</span></button></li>}
              {list.map(n => (
                <li key={n.key} className={n.key === sel ? 'active' : undefined}>
                  <button type="button" onClick={() => void pick(n.key)} title={n.title}>
                    <span className="notes-item-title">{n.title}</span>
                    <span className="as-meta notes-item-date">{fmtDate(n.updated_at)}</span>
                    {n.snippet && <span className="as-meta notes-item-snippet">{n.snippet}</span>}
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="as-meta as-history-empty">{query ? 'No notes match' : 'No notes yet'}</li>}
            </ul>
          )}
        </aside>

        <section className="notes-main">
          {sel == null ? (
            <div className="as-empty">
              <Icon name="note" size={28} className="empty-icon" />
              <h1>Write something down</h1>
              <p className="as-meta">Plans, preferences, things to remember. The assistant searches your notes when a question touches them, and can draft changes that you apply.</p>
              <button type="button" className="btn-primary" onClick={() => void startNew()}><Icon name="plus" size={14} /> New note</button>
            </div>
          ) : (
            <>
              <div className="notes-bar">
                <button type="button" className="btn-ghost btn-sm notes-back" onClick={() => setEditing(false)}>Back to notes</button>
                <input className="field-input notes-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" maxLength={80} aria-label="Title" />
              </div>
              {loading ? <Loading rows={8} /> : (
                <Suspense fallback={<Loading rows={8} />}>
                  <MarkdownEditor key={docId} value={body} onChange={setBody} />
                </Suspense>
              )}
              <div className="notes-foot">
                {sel !== 'new' && sel !== PROTECTED_NOTE && <button type="button" className="btn-ghost notes-delete" onClick={() => void del()}>Delete</button>}
                <span className="as-meta notes-state">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : sel === 'new' ? '' : 'Saved'}</span>
                {sel !== 'new' && <button type="button" className="btn-ghost" onClick={() => onAskAbout(title)} title="Start a chat about this note"><Icon name="assistant" size={14} /> Ask about this note</button>}
                <button type="button" className="btn-primary" onClick={() => void save()} disabled={!canSave}>Save</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
