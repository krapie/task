import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/api'
import type { MailAccount, MailItem } from '../types'

type Panel = 'inbox' | 'accounts'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function buildSrcdoc(html: string, isDark: boolean): string {
  // App dark bg is #0a0a0a. invert(#0a0a0a) = #f5f5f5, so use that as
  // the pre-inversion background so post-inversion matches the app exactly.
  const bg = isDark ? '#f5f5f5' : '#ffffff'
  const darkCss = isDark ? `
  html {
    filter: invert(100%) hue-rotate(180deg);
    background: ${bg};
  }
  img, video, iframe, svg {
    filter: invert(100%) hue-rotate(180deg);
  }` : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' *; img-src https: data: cid:; font-src *;">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px; line-height: 1.6;
    color: #1a1a1a; background: ${bg};
    word-break: break-word; overflow-wrap: break-word;
  }
  a { color: #0066cc; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre, code { white-space: pre-wrap; word-break: break-all; }
  ${darkCss}
</style>
</head>
<body>${html}</body>
</html>`
}

// Auto-resize iframe to its content height
function AutoIframe({ srcdoc }: { srcdoc: string }) {
  const ref = useRef<HTMLIFrameElement>(null)

  function onLoad() {
    const iframe = ref.current
    if (!iframe) return
    try {
      const height = iframe.contentDocument?.documentElement?.scrollHeight
      if (height) iframe.style.height = `${height}px`
    } catch {
      // cross-origin or sandboxed — leave height as-is
    }
  }

  return (
    <iframe
      ref={ref}
      srcDoc={srcdoc}
      sandbox="allow-popups allow-same-origin"
      title="Email content"
      onLoad={onLoad}
      style={{ width: '100%', minHeight: '200px', border: 'none', display: 'block' }}
    />
  )
}

interface AddAccountFormProps {
  onAdd: (account: MailAccount) => void
  onCancel: () => void
}

function AddAccountForm({ onAdd, onCancel }: AddAccountFormProps) {
  const [label, setLabel] = useState('')
  const [email, setEmail] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [tls, setTls] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const acct = await api.mail.addAccount({
        label: label.trim(),
        email: email.trim(),
        host: host.trim(),
        port: parseInt(port) || 993,
        tls,
        username: username.trim(),
        password,
      } as Omit<MailAccount, 'id' | 'last_synced'>)
      onAdd(acct)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="mail-add-form" onSubmit={submit}>
      <h3 className="mail-form-title">Add mail account</h3>
      {error && <p className="mail-error">{error}</p>}
      <div className="mail-form-field">
        <label>Label</label>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Gmail" required />
      </div>
      <div className="mail-form-field">
        <label>Email address</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@gmail.com" required />
      </div>
      <div className="mail-form-field">
        <label>IMAP host</label>
        <input type="text" value={host} onChange={e => setHost(e.target.value)} placeholder="imap.gmail.com" required />
      </div>
      <div className="mail-form-row">
        <div className="mail-form-field">
          <label>Port</label>
          <input type="number" value={port} onChange={e => setPort(e.target.value)} placeholder="993" />
        </div>
        <div className="mail-form-field">
          <label>TLS</label>
          <label className="mail-toggle">
            <input type="checkbox" checked={tls} onChange={e => setTls(e.target.checked)} />
            <span>Enabled</span>
          </label>
        </div>
      </div>
      <div className="mail-form-field">
        <label>Username</label>
        <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="you@gmail.com" required />
      </div>
      <div className="mail-form-field">
        <label>Password / App password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
      </div>
      <div className="mail-form-actions">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Adding…' : 'Add account'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

interface MailInboxProps {
  isAuth: boolean
  isDark: boolean
  onUnreadCount?: (n: number) => void
}

export function MailInbox({ isAuth, isDark, onUnreadCount }: MailInboxProps) {
  if (!isAuth) {
    return (
      <div className="mail-inbox">
        <div className="mail-empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Sign in to view mail
        </div>
      </div>
    )
  }

  const [panel, setPanel] = useState<Panel>('inbox')
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [items, setItems] = useState<MailItem[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [activeAccount, setActiveAccount] = useState<string | null>(null)
  const [showFlagged, setShowFlagged] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MailItem | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 600)

  const loadAccounts = useCallback(async () => {
    const accts = await api.mail.getAccounts().catch(() => [])
    setAccounts(accts)
  }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    const mails = await api.mail.getItems({
      account_id: showFlagged ? undefined : (activeAccount ?? undefined),
      flagged: showFlagged ? true : undefined,
      limit: 100,
    }).catch(() => [])
    setItems(mails)
    setLoading(false)
  }, [activeAccount, showFlagged])

  // Initial load
  useEffect(() => {
    loadAccounts()
    loadItems()
  }, [loadAccounts, loadItems])

  // Auto-sync on tab open (MailInbox mounts each time mail tab is selected)
  useEffect(() => {
    setSyncing(true)
    api.mail.sync().catch(console.error).finally(async () => {
      await loadItems()
      await loadAccounts()
      setSyncing(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic refresh from DB every 3 minutes (picks up background poller results)
  useEffect(() => {
    const id = setInterval(async () => {
      await loadItems()
      await loadAccounts()
    }, 3 * 60 * 1000)
    return () => clearInterval(id)
  }, [loadItems, loadAccounts])

  async function handleSync() {
    setSyncing(true)
    await api.mail.sync(activeAccount ?? undefined).catch(console.error)
    await loadItems()
    await loadAccounts()
    setSyncing(false)
  }

  async function handleMarkRead(item: MailItem) {
    if (item.read) return
    await api.mail.markRead(item.id).catch(console.error)
    setItems(prev => prev.map(m => m.id === item.id ? { ...m, read: true } : m))
    if (selectedItem?.id === item.id) setSelectedItem(prev => prev ? { ...prev, read: true } : prev)
  }

  async function handleToggleFlag(item: MailItem, e: React.MouseEvent) {
    e.stopPropagation()
    const { flagged } = await api.mail.toggleFlag(item.id).catch(() => ({ flagged: item.flagged }))
    setItems(prev => prev.map(m => m.id === item.id ? { ...m, flagged } : m))
    if (selectedItem?.id === item.id) setSelectedItem(prev => prev ? { ...prev, flagged } : prev)
  }

  async function handleDeleteAccount(id: string) {
    await api.mail.removeAccount(id).catch(console.error)
    setAccounts(prev => prev.filter(a => a.id !== id))
    if (activeAccount === id) setActiveAccount(null)
  }

  async function handleItemClick(item: MailItem) {
    setSelectedItem(item)
    handleMarkRead(item)
    if (item.html_body === undefined && item.body === undefined) {
      setBodyLoading(true)
      const full = await api.mail.getItem(item.id).catch(() => null)
      if (full) {
        const patch = { body: full.body, html_body: full.html_body }
        setSelectedItem(prev => prev?.id === item.id ? { ...prev, ...patch } : prev)
        setItems(prev => prev.map(m => m.id === item.id ? { ...m, ...patch } : m))
      }
      setBodyLoading(false)
    }
  }

  const unreadCount = items.filter(m => !m.read).length

  useEffect(() => {
    onUnreadCount?.(unreadCount)
  }, [unreadCount, onUnreadCount])

  const showDetail = selectedItem !== null && panel === 'inbox'

  return (
    <div className="mail-inbox">
      {/* Backdrop for mobile sidebar overlay */}
      {sidebarOpen && <div className="sidebar-mobile-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar — in-flow on desktop, overlay on mobile */}
      {sidebarOpen && (
        <div className="mail-sidebar">
          <div className="mail-sidebar-header">Mail</div>
          <div className="mail-nav">
            <button
              className={`mail-nav-item${panel === 'inbox' && !showFlagged ? ' mail-nav-active' : ''}`}
              onClick={() => { setPanel('inbox'); setShowFlagged(false); setSelectedItem(null) }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
              </svg>
              Inbox
              {unreadCount > 0 && <span className="mail-badge">{unreadCount}</span>}
            </button>
            <button
              className={`mail-nav-item${showFlagged ? ' mail-nav-active' : ''}`}
              onClick={() => { setShowFlagged(true); setPanel('inbox'); setSelectedItem(null) }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
              </svg>
              Flagged
            </button>
            <button
              className={`mail-nav-item${panel === 'accounts' ? ' mail-nav-active' : ''}`}
              onClick={() => { setPanel('accounts'); setShowFlagged(false); setSelectedItem(null) }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
              Accounts
            </button>
          </div>

          {panel === 'inbox' && accounts.length > 0 && (
            <div className="mail-sidebar-accounts">
              <div style={{ fontFamily: 'var(--kp-font-mono)', fontSize: '10px', color: 'var(--kp-fg-4)', padding: '4px 8px', marginBottom: '4px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Accounts</div>
              <button
                className={`mail-filter-btn${activeAccount === null ? ' mail-filter-active' : ''}`}
                onClick={() => setActiveAccount(null)}
              >All</button>
              {accounts.map(a => (
                <button
                  key={a.id}
                  className={`mail-filter-btn${activeAccount === a.id ? ' mail-filter-active' : ''}`}
                  onClick={() => setActiveAccount(a.id)}
                >{a.label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* List pane — hidden when detail is open */}
      <div className={`mail-main${showDetail ? ' mail-main-hidden' : ''}`}>
        {panel === 'inbox' ? (
          <>
            <div className="mail-toolbar">
              <button className="icon-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle sidebar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" />
                </svg>
              </button>
              <span className="mail-toolbar-title">
                {showFlagged ? 'Flagged' : activeAccount ? accounts.find(a => a.id === activeAccount)?.label : 'Inbox'}
              </span>
              {!showFlagged && unreadCount > 0 && (
                <span style={{ fontFamily: 'var(--kp-font-mono)', fontSize: '11px', color: 'var(--kp-fg-4)' }}>{unreadCount} unread</span>
              )}
              <div style={{ flex: 1 }} />
              <button className="icon-btn" onClick={handleSync} disabled={syncing} aria-label="Sync">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  style={{ animation: syncing ? 'mail-spin 1s linear infinite' : undefined }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>

            {loading ? (
              <div className="mail-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="mail-empty">
                {accounts.length === 0
                  ? 'Add an account to get started'
                  : 'No messages. Sync to fetch new mail.'}
              </div>
            ) : (
              <div className="mail-list">
                {items.map(item => (
                  <button
                    key={item.id}
                    className={`mail-item${!item.read ? ' mail-item-unread' : ''}${selectedItem?.id === item.id ? ' mail-item-selected' : ''}`}
                    onClick={() => handleItemClick(item)}
                  >
                    <div className="mail-item-header">
                      <span className="mail-item-from">{item.from_name || item.from_address}</span>
                      <span className="mail-item-date">{formatDate(item.received_at)}</span>
                      <button
                        className={`flag-btn${item.flagged ? ' flag-btn-active' : ''}`}
                        onClick={e => handleToggleFlag(item, e)}
                        aria-label={item.flagged ? 'Unflag' : 'Flag'}
                      >★</button>
                    </div>
                    <div className="mail-item-subject">{item.subject}</div>
                    {item.snippet && <div className="mail-item-snippet">{item.snippet}</div>}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="mail-accounts-panel">
            <div className="mail-toolbar">
              <button className="icon-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle sidebar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" />
                </svg>
              </button>
              <span className="mail-toolbar-title">Mail accounts</span>
              <div style={{ flex: 1 }} />
              {!showAddForm && (
                <button className="btn-ghost btn-sm" onClick={() => setShowAddForm(true)}>
                  + Add account
                </button>
              )}
            </div>

            {showAddForm && (
              <AddAccountForm
                onAdd={acct => { setAccounts(prev => [...prev, acct]); setShowAddForm(false) }}
                onCancel={() => setShowAddForm(false)}
              />
            )}

            {accounts.length === 0 && !showAddForm ? (
              <div className="mail-empty">No accounts configured.</div>
            ) : (
              <div className="mail-account-list">
                {accounts.map(a => (
                  <div key={a.id} className="mail-account-row">
                    <div className="mail-account-info">
                      <span className="mail-account-label">{a.label}</span>
                      <span className="mail-account-email">{a.email}</span>
                      <span className="mail-account-meta">{a.host}:{a.port} · {a.tls ? 'TLS' : 'plain'}</span>
                      {a.last_synced && (
                        <span className="mail-account-meta">Last synced {formatDate(a.last_synced)}</span>
                      )}
                    </div>
                    <button
                      className="icon-btn mail-account-delete"
                      onClick={() => handleDeleteAccount(a.id)}
                      aria-label={`Remove ${a.label}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full-width detail pane — replaces list when open */}
      {showDetail && selectedItem && (
        <div className="mail-detail">
          <div className="mail-detail-header">
            <button className="icon-btn" onClick={() => setSelectedItem(null)} aria-label="Back to inbox">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </button>
            <h3 className="mail-detail-subject">{selectedItem.subject}</h3>
            <button
              className={`flag-btn${selectedItem.flagged ? ' flag-btn-active' : ''}`}
              onClick={e => handleToggleFlag(selectedItem, e)}
              aria-label={selectedItem.flagged ? 'Unflag' : 'Flag'}
            >★</button>
          </div>
          <div className="mail-detail-meta">
            <span>From: {selectedItem.from_name ? `${selectedItem.from_name} <${selectedItem.from_address}>` : selectedItem.from_address}</span>
            <span>{new Date(selectedItem.received_at).toLocaleString()}</span>
          </div>
          <div className="mail-detail-body">
            {bodyLoading ? (
              <div className="mail-empty">Loading…</div>
            ) : selectedItem.html_body ? (
              <AutoIframe srcdoc={buildSrcdoc(selectedItem.html_body, isDark)} />
            ) : selectedItem.body ? (
              <pre className="mail-detail-plain">{selectedItem.body}</pre>
            ) : (
              <div className="mail-empty">(no content)</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
