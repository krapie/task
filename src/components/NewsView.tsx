import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { NewsItem } from '../types'
import { notifyError } from '../lib/notify'
import { Empty, Loading } from './Ui'
import { Icon } from './Icons'
import { useSidebarOpen } from '../lib/useSidebarOpen'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

function mergeNewsItems(existing: NewsItem[], fresh: NewsItem[]): NewsItem[] {
  const existingMap = new Map(existing.map(n => [n.link, n]))
  const freshMap = new Map(fresh.map(n => [n.link, n]))
  const newItems = fresh.filter(n => !existingMap.has(n.link))
  const updatedExisting = existing.map(n => freshMap.get(n.link) ?? n)
  return [...newItems, ...updatedExisting]
}

// Render HTML preview from feed <content> directly
function NewsPreview({ html }: { html: string }) {
  return (
    <div
      className="news-item-preview"
      // Content comes from the hada.io Atom feed — trusted source
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
    await api.news.unflag(item.link).catch(notifyError)
    setItems(prev => prev.map(n => n.link === item.link ? { ...n, flagged: false } : n))
  } else {
    await api.news.flag({ link: item.link, title: item.title, author: item.author, published: item.published, preview: item.preview })
      .catch(notifyError)
    setItems(prev => prev.map(n => n.link === item.link ? { ...n, flagged: true } : n))
  }
}

function NewsItemCard({ item, setItems, canFlag }: { item: NewsItem; setItems: React.Dispatch<React.SetStateAction<NewsItem[]>>; canFlag: boolean }) {
  return (
    <div className="news-item">
      <div className="news-item-header">
        <a
          className="news-item-title"
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
        >{item.title}</a>
        {canFlag && (
          <button
            className={`flag-btn${item.flagged ? ' flag-btn-active' : ''}`}
            onClick={e => handleFlagToggle(item, setItems, e)}
            aria-label={item.flagged ? 'Unflag' : 'Flag'}
          >★</button>
        )}
      </div>
      {item.preview && <NewsPreview html={item.preview} />}
      <div className="news-item-meta">
        <span>{item.author}</span>
        {item.published && <span>{timeAgo(item.published)}</span>}
      </div>
    </div>
  )
}

export function NewsView({ isAuth }: { isAuth: boolean }) {
  const [items, setItems] = useState<NewsItem[]>([])
  const [flaggedItems, setFlaggedItems] = useState<NewsItem[]>([])
  const [tab, setTab] = useState<'all' | 'flagged'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen('task_news_sidebar')

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null) }
    try {
      // Flagged stories are per-account; guests only get the public feed
      const [feed, flagged] = await Promise.all([
        api.news.getItems(),
        isAuth ? api.news.getFlagged() : Promise.resolve([]),
      ])
      if (silent) {
        setItems(prev => mergeNewsItems(prev, feed))
        setFlaggedItems(prev => mergeNewsItems(prev, flagged))
      } else {
        setItems(feed)
        setFlaggedItems(flagged)
      }
    } catch {
      if (!silent) setError('Failed to load feed')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [isAuth])

  useEffect(() => { load() }, [load])

  // Refresh when browser tab becomes visible
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible') load(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [load])

  // Auto-refresh every 10 minutes
  useEffect(() => {
    const id = setInterval(() => load(true), 10 * 60 * 1000)
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

  const displayed = (tab === 'all' ? items : flaggedItems)
    .filter(item => !item.title.startsWith('Show GN'))
  const flagCount = items.filter(i => i.flagged).length + flaggedItems.filter(i => !items.some(x => x.link === i.link)).length

  return (
    <div className="split-view">
      {/* Backdrop for mobile sidebar overlay */}
      {sidebarOpen && <div className="sidebar-mobile-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      {sidebarOpen && (
        <div className="split-sidebar">
          <div className="split-sidebar-header">News</div>
          <div className="split-nav">
            <button
              className={`split-nav-item${tab === 'all' ? ' split-nav-active' : ''}`}
              onClick={() => setTab('all')}
            >
              <Icon name="news" size={16} />
              All
              {items.length > 0 && <span className="news-nav-count">{items.length}</span>}
            </button>
            {isAuth && <button
              className={`split-nav-item${tab === 'flagged' ? ' split-nav-active' : ''}`}
              onClick={() => setTab('flagged')}
            >
              <Icon name="flag" size={16} />
              Flagged
              {flagCount > 0 && <span className="news-nav-count">{flagCount}</span>}
            </button>}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="split-main">
        <div className="split-toolbar">
          <button className="icon-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle sidebar">
            <Icon name="sidebar" size={16} />
          </button>
          <span className="split-toolbar-title grow">{tab === 'all' ? 'GeekNews' : 'Flagged'}</span>
          <button className="icon-btn" onClick={() => load()} disabled={loading} aria-label="Refresh">
            <Icon name="refresh" size={16} style={{ animation: loading ? 'mail-spin 1s linear infinite' : undefined }} />
          </button>
        </div>

        {error ? (
          <div className="news-empty"><Empty icon="refresh" title="Couldn't load the feed" hint={error} action={{ label: 'Try again', onClick: () => load() }} /></div>
        ) : loading && displayed.length === 0 ? (
          <div className="news-empty"><Loading /></div>
        ) : displayed.length === 0 ? (
          <div className="news-empty">
            {tab === 'flagged'
              ? <Empty icon="flag" title="No flagged stories" hint="Flag a story to save it for later." />
              : <Empty icon="news" title="No stories" hint="The feed is empty right now. Try refreshing." action={{ label: 'Refresh', onClick: () => load() }} />}
          </div>
        ) : (
          <div className="news-list">
            {displayed.map((item, i) => (
              <NewsItemCard
                key={i}
                item={item}
                setItems={tab === 'all' ? setItemsWithSync : setFlaggedWithSync}
                canFlag={isAuth}
              />
            ))}
          </div>
        )}

        <div className="news-footer">π  kevinprk.com</div>
      </div>
    </div>
  )
}
