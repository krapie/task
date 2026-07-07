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

export function NewsView() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.news.getItems()
      setItems(data)
    } catch {
      setError('Failed to load feed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="news-view">
      <div className="news-toolbar">
        <span className="news-toolbar-title">GeekNews</span>
        <button className="icon-btn" onClick={load} disabled={loading} aria-label="Refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            style={{ animation: loading ? 'mail-spin 1s linear infinite' : undefined }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
      </div>

      {error ? (
        <div className="news-empty">{error}</div>
      ) : loading && items.length === 0 ? (
        <div className="news-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="news-empty">No items</div>
      ) : (
        <div className="news-list">
          {items.map((item, i) => (
            <a
              key={i}
              className="news-item"
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="news-item-title">{item.title}</div>
              {item.preview && <div className="news-item-preview">{item.preview}</div>}
              <div className="news-item-meta">
                <span>{item.author}</span>
                {item.published && <span>{timeAgo(item.published)}</span>}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
