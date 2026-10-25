// One panel of the Overview: a small-caps title (a link when it opens a tab), an optional count and the body.
export function Panel({ title, count, onOpen, className = '', children }: { title: string; count?: string; onOpen?: () => void; className?: string; children: React.ReactNode }) {
  return (
    <section className={`ov-panel ${className}`}>
      <header className="ov-head">
        {onOpen
          ? <button type="button" className="ov-title ov-title-link" onClick={onOpen}>{title}</button>
          : <span className="ov-title">{title}</span>}
        {count && <span className="ov-count">{count}</span>}
      </header>
      {children}
    </section>
  )
}
