import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { NewsItem } from '../types'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

// Plain text preview from server → split into bullet lines
function PreviewBullets({ text }: { text: string }) {
  // Each bullet is separated by content that was originally an <li>
  // The strip leaves sentences run together; split on sentence-ending patterns
  // The server strips tags so we get lines like "• Foo • Bar" or just flat text.
  // Split on " • " if present, otherwise show as-is
  const lines = text
    .split(/(?<=[음임함됨짐짐])\s+(?=[가-힣A-Za-z])/)  // split after Korean sentence-final endings
    .flatMap(l => l.split(/\s{2,}/))                    // also split on double spaces
    .map(l => l.trim())
    .filter(Boolean)

  if (lines.length <= 1) return <p className="news-item-preview-text">{text}</p>

  return (
    <ul className="news-item-preview-list">
      {lines.slice(0, 5).map((l, i) => <li key={i}>{l}</li>)}
    </ul>
  )
}

async function handleFlagToggle(
  item: NewsItem,
  setItems: React.Dispatch<React.SetStateAction<NewsItem[]>>,
  e: React.MouseEvent
) {
  e.preventDefault()
  e.stopPropagation()
  if (item.flagged) {
    await api.news.unflag(item.link).catch(console.error)
    setItems(prev => prev.map(n => n.link === item.link ? { ...n, flagged: false } : n))
  } else {
    await api.news.flag({ link: item.link, title: item.title, author: item.author, published: item.published, preview: item.preview })
      .catch(console.error)
    setItems(prev => prev.map(n => n.link === item.link ? { ...n, flagged: true } : n))
  }
}

function NewsItemCard({ item, setItems }: { item: NewsItem; setItems: React.Dispatch<React.SetStateAction<NewsItem[]>> }) {
  return (
    <div className="news-item">
      <div className="news-item-header">
        <a
          className="news-item-title"
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
        >{item.title}</a>
        <button
          className={`flag-btn${item.flagged ? ' flag-btn-active' : ''}`}
          onClick={e => handleFlagToggle(item, setItems, e)}
          aria-label={item.flagged ? 'Unflag' : 'Flag'}
        >★</button>
      </div>
      {item.preview && <PreviewBullets text={item.preview} />}
      <div className="news-item-meta">
        <span>{item.author}</span>
        {item.published && <span>{timeAgo(item.published)}</span>}
      </div>
    </div>
  )
}

export function NewsView() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [flaggedItems, setFlaggedItems] = useState<NewsItem[]>([])
  const [tab, setTab] = useState<'all' | 'flagged'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [feed, flagged] = await Promise.all([
        api.news.getItems(),
        api.news.getFlagged(),
      ])
      setItems(feed)
      setFlaggedItems(flagged)
    } catch {
      setError('Failed to load feed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Refresh when browser tab becomes visible
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [load])

  // Auto-refresh every 10 minutes
  useEffect(() => {
    const id = setInterval(load, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [load])

  // Keep flaggedItems in sync with flag state changes on feed items
  const setItemsWithSync: React.Dispatch<React.SetStateAction<NewsItem[]>> = (update) => {
    setItems(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      // sync flagged state into flaggedItems
      next.forEach(item => {
        if (item.flagged) {
          setFlaggedItems(f => f.some(x => x.link === item.link) ? f.map(x => x.link === item.link ? item : x) : [item, ...f])
        } else {
          setFlaggedItems(f => f.filter(x => x.link !== item.link))
        }
      })
      return next
    })
  }

  const setFlaggedWithSync: React.Dispatch<React.SetStateAction<NewsItem[]>> = (update) => {
    setFlaggedItems(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      setItems(f => f.map(item => {
        const match = next.find(x => x.link === item.link)
        return match ? { ...item, flagged: match.flagged } : item
      }))
      return next
    })
  }

  const displayed = tab === 'all' ? items : flaggedItems
  const flagCount = items.filter(i => i.flagged).length + flaggedItems.filter(i => !items.some(x => x.link === i.link)).length

  return (
    <div className="news-view">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="news-sidebar">
          <div className="news-sidebar-header">News</div>
          <div className="news-nav">
            <button
              className={`news-nav-item${tab === 'all' ? ' news-nav-active' : ''}`}
              onClick={() => setTab('all')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
              </svg>
              All
              {items.length > 0 && <span className="news-nav-count">{items.length}</span>}
            </button>
            <button
              className={`news-nav-item${tab === 'flagged' ? ' news-nav-active' : ''}`}
              onClick={() => setTab('flagged')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
              </svg>
              Flagged
              {flagCount > 0 && <span className="news-nav-count">{flagCount}</span>}
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="news-main">
        <div className="news-toolbar">
          <button className="icon-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle sidebar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
          </button>
          <span className="news-toolbar-title">{tab === 'all' ? 'GeekNews' : 'Flagged'}</span>
          <button className="icon-btn" onClick={load} disabled={loading} aria-label="Refresh">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              style={{ animation: loading ? 'mail-spin 1s linear infinite' : undefined }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>

        {error ? (
          <div className="news-empty">{error}</div>
        ) : loading && displayed.length === 0 ? (
          <div className="news-empty">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="news-empty">{tab === 'flagged' ? 'No flagged stories.' : 'No items'}</div>
        ) : (
          <div className="news-list">
            {displayed.map((item, i) => (
              <NewsItemCard
                key={i}
                item={item}
                setItems={tab === 'all' ? setItemsWithSync : setFlaggedWithSync}
              />
            ))}
          </div>
        )}

        <div className="news-footer">π  kevinprk.com</div>
      </div>
    </div>
  )
}
