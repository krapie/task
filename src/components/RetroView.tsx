import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { notify, notifyError, promptDialog } from '../lib/notify'
import type { GoalCategory, GoalItem, GoalPeriod } from '../types'
import { GoalItemRow } from './GoalView'
import { Empty, Loading } from './Ui'

// Yearly retrospective (Keep / Problem / Try / Action Items). Stored as a goal period of kind 'retro'; each section is a
// fixed category, each entry a goal item (text, comment, crossed out when dropped).
const RETRO_SECTION_NAMES = ['Keep', 'Problem', 'Try', 'Action Items'] as const
type RetroSectionName = (typeof RETRO_SECTION_NAMES)[number]
const SECTION_LABEL: Record<RetroSectionName, string> = { Keep: 'Keep', Problem: 'Problem', Try: 'Try', 'Action Items': 'Action items' }
const sectionHint = (name: RetroSectionName, year: number) =>
  name === 'Keep' ? 'What went well' : name === 'Problem' ? 'What fell short' : name === 'Try' ? 'Worth trying' : `What to do in ${year + 1}`
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function RetroView() {
  const thisYear = new Date().getFullYear()
  const [periods, setPeriods] = useState<GoalPeriod[] | null>(null)
  const [year, setYear] = useState(thisYear)

  useEffect(() => {
    api.goals.getAll()
      .then(all => {
        const retros = all.filter(p => p.kind === 'retro')
        setPeriods(retros)
        // Open on the most recent retro that exists; fall back to this year.
        const latest = retros.reduce<number | null>((m, p) => (p.year != null && (m == null || p.year > m) ? p.year : m), null)
        if (latest != null) setYear(latest)
      })
      .catch(e => { notifyError(e); setPeriods([]) })
  }, [])

  const years = useMemo(
    () => Array.from(new Set([...(periods ?? []).map(p => p.year as number), thisYear])).sort((a, b) => a - b),
    [periods, thisYear],
  )
  const period = periods?.find(p => p.year === year)

  function putPeriod(p: GoalPeriod) {
    setPeriods(prev => [...(prev ?? []).filter(x => x.id !== p.id), p])
  }

  async function start(y: number) {
    try {
      putPeriod(await api.goals.getOrCreateRetro(y))
      setYear(y)
    } catch (e) { notifyError(e) }
  }

  async function addYear() {
    const v = await promptDialog({ title: 'New retro year', body: 'Which year is it for?', placeholder: String(thisYear), confirmLabel: 'Create' })
    const y = parseInt(v ?? '', 10)
    if (!Number.isInteger(y) || y < 2000 || y > 2100) { if (v) notify('Enter a year between 2000 and 2100', 'error'); return }
    await start(y)
  }

  function updateCategory(c: GoalCategory) {
    if (!period) return
    putPeriod({ ...period, categories: period.categories.map(x => (x.id === c.id ? c : x)) })
  }

  return (
    <div className="goal-view retro-view">
      <div className="goal-year-bar retro-bar">
        <div className="goal-year-tabs">
          {years.map(y => (
            <button key={y} className={`goal-year-btn${y === year ? ' goal-year-active' : ''}`} onClick={() => setYear(y)}>{y}</button>
          ))}
          <button className="goal-add-year-btn" onClick={addYear} title="Add year">+</button>
        </div>
      </div>

      <div className="retro-body">
        {periods === null ? (
          <Loading rows={4} />
        ) : !period ? (
          <Empty
            icon="flag"
            title={`No retro for ${year}`}
            hint="Keep, Problem, Try and Action items for the year. Start a blank one."
            action={{ label: `Start ${year} retro`, onClick: () => { void start(year) } }}
          />
        ) : (
          <div className="retro-grid">
            {RETRO_SECTION_NAMES.map(name => {
              const category = period.categories.find(c => sameName(c.name, name))
              return category ? (
                <RetroSection key={name} name={name} year={year} category={category} onChange={updateCategory} />
              ) : null
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function RetroSection({ name, year, category, onChange }: { name: RetroSectionName; year: number; category: GoalCategory; onChange: (c: GoalCategory) => void }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    try {
      const item = await api.goals.createItem(category.id, t)
      onChange({ ...category, items: [...category.items, item] })
      setText('')
    } catch (err) { notifyError(err) }
  }
  async function remove(id: string) {
    try {
      await api.goals.deleteItem(id)
      onChange({ ...category, items: category.items.filter(i => i.id !== id) })
    } catch (err) { notifyError(err) }
  }
  const update = (item: GoalItem) => onChange({ ...category, items: category.items.map(i => (i.id === item.id ? item : i)) })

  return (
    <section className="goal-category retro-section" aria-label={SECTION_LABEL[name]}>
      <div className="retro-section-head">
        <span className="section-label">{SECTION_LABEL[name]}</span>
        <span className="retro-hint">{sectionHint(name, year)}</span>
      </div>
      <div className="goal-items">
        {category.items.map(item => (
          <GoalItemRow key={item.id} item={item} onUpdate={update} onDelete={() => { void remove(item.id) }} />
        ))}
        {adding ? (
          <form className="goal-add-item-form" onSubmit={add}>
            <input
              className="goal-item-input"
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="New entry"
              onKeyDown={e => { if (e.key === 'Escape') { setAdding(false); setText('') } }}
            />
            <button type="submit" className="goal-add-confirm">Add</button>
            <button type="button" className="goal-add-cancel" onClick={() => { setAdding(false); setText('') }}>Cancel</button>
          </form>
        ) : (
          <button className="goal-add-item-btn" onClick={() => setAdding(true)}>+ Add item</button>
        )}
      </div>
    </section>
  )
}
