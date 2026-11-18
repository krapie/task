import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/notify'
import { Icon } from './Icons'
import type { BrowserSite, ReservationJob } from '../types'

// Integrations (the sites the assistant's browser may use) and Schedule (the reservations it runs at a shop's opening time):
// two views in the chat area of the Assistant tab, opened from the icons in its top bar. They used to sit inside the browser panel.

export const ACTIVE_JOB: ReservationJob['state'][] = ['scheduled', 'preparing', 'running']
export const RESERVATION_STATE: Record<ReservationJob['state'], string> = {
  scheduled: 'Waiting for the opening',
  preparing: 'Taking over the browser',
  running: 'Reserving now',
  succeeded: 'Reserved',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Missed',
  dry_run_done: 'Dry run finished',
}
const ATTEMPT_LABEL: Record<string, string> = {
  preflight: 'Sign-in check before the opening',
  prepare: 'Took the browser over',
  open: 'The shop opened',
  gate: 'Final confirmation allowed',
  refused: 'Final confirmation refused',
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
const signInText = (s: BrowserSite) => s.login_status === 'signed_in' ? `Signed in${s.login_checked_at ? ` · checked ${ago(s.login_checked_at)}` : ''}` : s.login_status === 'needs_login' ? 'Needs sign-in' : 'Sign-in not checked'
const kst = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Seoul', hour12: false, ...opts })

// The reservation jobs, refreshed every `everyMs` while mounted (a run changes state within seconds).
export function useReservations(everyMs: number) {
  const [jobs, setJobs] = useState<ReservationJob[] | null>(null)
  const load = useCallback(() => { api.assistant.reservations().then(setJobs, () => {}) }, [])
  useEffect(() => {
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, everyMs)
    return () => clearInterval(t)
  }, [load, everyMs])
  return { jobs, load }
}

// One line at the top of the conversation list: what waits, or how the last one ended.
export function ReservationLine({ onOpen }: { onOpen: () => void }) {
  const { jobs } = useReservations(30_000)
  const active = (jobs ?? []).filter(j => ACTIVE_JOB.includes(j.state)).sort((a, b) => a.fire_at.localeCompare(b.fire_at))
  const recent = (jobs ?? []).find(j => !ACTIVE_JOB.includes(j.state) && Date.now() - Date.parse(j.fire_at) < 24 * 3600_000)
  const j = active[0] ?? recent
  if (!j) return null
  const when = `${kst(j.fire_at, { month: '2-digit', day: '2-digit' })} ${j.open_time}`
  const main = active[0] ? `${j.shop_name} · ${when}` : j.shop_name
  const sub = `${active.length > 1 ? `+${active.length - 1} more · ` : ''}${RESERVATION_STATE[j.state]}${!active[0] && j.result?.time ? ` · ${j.result.time}` : ''}`
  return (
    <button type="button" className="as-resline" onClick={onOpen} title="Open the schedule">
      <Icon name="calendar" size={14} />
      <span className="as-resline-text"><span className="as-resline-main">{main}</span><span className="as-resline-sub">{sub}</span></span>
    </button>
  )
}

// The schedule: every reservation job with what the run did, and Cancel while it still waits.
export function ScheduleView({ onOpenChat }: { onOpenChat: (id: string) => void }) {
  const { jobs, load } = useReservations(10_000)
  const [note, setNote] = useState<string | null>(null)
  return (
    <div className="as-tool-body">
      <p className="as-meta">Scheduled by the assistant and approved by you. At the opening time the assistant takes the browser over (your input pauses), tries the slots from the latest, and confirms only a reservation that costs nothing. Ask it to reserve a shop when it opens.</p>
      <ul className="br-site-list as-tool-list">
        {(jobs ?? []).length === 0 && <li className="as-meta">{jobs === null ? 'Loading…' : 'Nothing scheduled.'}</li>}
        {(jobs ?? []).map(j => {
          const active = ACTIVE_JOB.includes(j.state)
          return (
            <li key={j.id}>
              <div className="br-site-main">
                <span className="br-site-name">{j.shop_name}{j.mode === 'dry_run' ? ' · dry run' : ''}</span>
                <span className="as-meta br-site-domains">{j.date} {j.open_time} · {j.party} {j.party === 1 ? 'person' : 'people'} · {j.slots.join(' → ')}</span>
                <span className={`as-meta br-site-state${j.state === 'failed' || j.state === 'expired' ? ' br-site-state-warn' : ''}`}>{RESERVATION_STATE[j.state]}{j.result?.time ? ` · ${j.result.time}` : ''}{j.result?.booking_number ? ` · No. ${j.result.booking_number}` : ''}{j.result?.detail && !active ? ` · ${j.result.detail}` : ''}</span>
                {(j.attempts?.length ?? 0) > 0 && (
                  <details className="as-tool-history">
                    <summary className="as-meta">History ({j.attempts.length})</summary>
                    <ol>
                      {j.attempts.map((a, i) => (
                        <li key={i} className="as-meta"><span className="as-tool-time">{kst(a.at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {ATTEMPT_LABEL[a.kind] ?? a.kind}{a.note ? ` · ${a.note}` : ''}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              <div className="br-site-actions">
                {j.result?.conversation_id && <button type="button" className="btn-ghost btn-sm" onClick={() => onOpenChat(j.result.conversation_id!)}>Open the run</button>}
                {active && (
                  <button type="button" className="btn-ghost btn-sm" onClick={async () => { if (await confirmDialog({ title: 'Cancel reservation', body: `${j.shop_name} ${j.date} ${j.open_time}`, confirmLabel: 'Cancel reservation', danger: true })) { try { await api.assistant.cancelReservation(j.id); setNote(null) } catch (err) { setNote(err instanceof Error ? err.message : String(err)) } load() } }}>Cancel</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {note && <p className="as-meta br-site-note">{note}</p>}
    </div>
  )
}

// The sites the assistant's browser may use: add, switch off, remove, check or set up a sign-in. "Set up sign-in" opens the
// site in the browser panel (onSetUpSignIn), where the owner signs in by hand and the assistant watches the page.
export function IntegrationsView({ onSetUpSignIn }: { onSetUpSignIn: (s: BrowserSite) => void }) {
  const [sites, setSites] = useState<BrowserSite[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ label: '', url: '', login: '' })
  const [checking, setChecking] = useState<string | null>(null)
  const loadSites = useCallback(() => { api.assistant.sites().then(setSites, () => {}) }, [])
  useEffect(() => {
    loadSites()
    const t = setInterval(() => { if (!document.hidden) loadSites() }, 10_000) // the assistant may record a sign-in meanwhile
    return () => clearInterval(t)
  }, [loadSites])
  const synced = (ok: boolean) => setNote(ok ? null : 'Saved. The browser picks the new list up within a few minutes.')
  const addSite = async (e: FormEvent) => {
    e.preventDefault()
    setNote(null)
    try {
      const login = form.login.split(/[\s,]+/).filter(Boolean)
      const r = await api.assistant.addSite({ label: form.label, url: /^https?:\/\//i.test(form.url.trim()) ? form.url.trim() : `https://${form.url.trim()}`, ...(login.length ? { login_domains: login } : {}) })
      synced(r.synced)
      setForm({ label: '', url: '', login: '' })
      setAdding(false)
      loadSites()
    } catch (err) { setNote(err instanceof Error ? err.message : String(err)) }
  }
  const siteAction = async (fn: () => Promise<{ synced: boolean }>) => {
    setNote(null)
    try { synced((await fn()).synced); loadSites() } catch (err) { setNote(err instanceof Error ? err.message : String(err)) }
  }
  // "Check": the assistant opens the site's account page and records the answer.
  const check = async (s: BrowserSite) => {
    setChecking(s.id)
    setNote(`Checking ${s.label}…`)
    try {
      const r = await api.assistant.checkSignIn(s.id)
      setNote(`${s.label}: ${r.status === 'signed_in' ? 'signed in' : r.status === 'needs_login' ? 'signed out: use Set up sign-in' : r.note}`)
      loadSites()
    } catch (err) { setNote(err instanceof Error ? err.message : String(err)) } finally { setChecking(null) }
  }
  return (
    <div className="as-tool-body">
      <p className="as-meta">The sites the assistant's browser may use. Set up a sign-in once: the browser keeps the session, and the assistant looks at the page before it relies on it. You never give it a password.</p>
      <ul className="br-site-list as-tool-list">
        {(sites ?? []).map(s => (
          <li key={s.id} className={s.enabled ? '' : 'br-site-off'}>
            <div className="br-site-main">
              <span className="br-site-name">{s.label}</span>
              <span className="as-meta br-site-domains">{[...s.domains, ...s.login_domains].join(' · ')}</span>
              <span className={`as-meta br-site-state${s.login_status === 'needs_login' ? ' br-site-state-warn' : ''}`}>{signInText(s)}{s.login_note ? ` · ${s.login_note}` : ''}</span>
            </div>
            <div className="br-site-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={() => void check(s)} disabled={!s.enabled || checking !== null} title="Open the account page and see whether you are signed in" aria-label={`Check sign-in of ${s.label}`}>Check</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => onSetUpSignIn(s)} disabled={!s.enabled}>{s.login_status === 'signed_in' ? 'Sign in again' : 'Set up sign-in'}</button>
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
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setAdding(false); setNote(null) }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-ghost btn-sm br-site-add" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add site</button>
      )}
      {note && <p className="as-meta br-site-note">{note}</p>}
    </div>
  )
}
