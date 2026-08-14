import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import type { GoalPeriod, GoalCategory, GoalItem } from '../types'

function currentHalf(): { year: number; half: 1 | 2 } {
  const now = new Date()
  return { year: now.getFullYear(), half: now.getMonth() < 6 ? 1 : 2 }
}

interface GoalViewProps {
  isAuth: boolean
}

export function GoalView({ isAuth }: GoalViewProps) {
  const [periods, setPeriods] = useState<GoalPeriod[]>([])
  const [selectedYear, setSelectedYear] = useState(() => currentHalf().year)
  const [selectedHalf, setSelectedHalf] = useState<1 | 2>(() => currentHalf().half)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuth) { setLoading(false); return }
    api.goals.getAll()
      .then(async loaded => {
        setPeriods(loaded)
        // The general (bucket-list) period is always shown next to the
        // half-year goals, so make sure it exists from the first visit
        // instead of requiring an explicit "initialize" step.
        if (!loaded.some(p => p.kind === 'general')) {
          const general = await api.goals.getOrCreateGeneral()
          setPeriods(prev => [...prev, general])
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isAuth])

  if (!isAuth) {
    return (
      <div className="goal-view">
        <div className="goal-empty">Sign in to view goals</div>
      </div>
    )
  }

  const halfPeriod = periods.find(p => p.kind === 'half' && p.year === selectedYear && p.half === selectedHalf) ?? null
  const generalPeriod = periods.find(p => p.kind === 'general') ?? null

  const allYears = Array.from(new Set([
    ...periods.filter(p => p.kind === 'half').map(p => p.year as number),
    currentHalf().year,
  ])).sort((a, b) => b - a)

  async function handleCreatePeriod() {
    try {
      const p = await api.goals.createPeriod(selectedYear, selectedHalf)
      setPeriods(prev => [p, ...prev].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.half ?? 0) - (a.half ?? 0)))
    } catch (e) { console.error(e) }
  }

  function updatePeriod(updated: GoalPeriod) {
    setPeriods(prev => prev.map(p => p.id === updated.id ? updated : p))
  }

  return (
    <div className="goal-view">
      <div className="goal-columns">
        <div className="goal-half-column">
          <div className="goal-period-bar">
            <div className="goal-year-tabs">
              {allYears.map(y => (
                <button
                  key={y}
                  className={`goal-year-btn${y === selectedYear ? ' goal-year-active' : ''}`}
                  onClick={() => setSelectedYear(y)}
                >{y}</button>
              ))}
            </div>
            <div className="goal-half-tabs">
              <button
                className={`goal-half-btn${selectedHalf === 1 ? ' goal-half-active' : ''}`}
                onClick={() => setSelectedHalf(1)}
              >H1</button>
              <button
                className={`goal-half-btn${selectedHalf === 2 ? ' goal-half-active' : ''}`}
                onClick={() => setSelectedHalf(2)}
              >H2</button>
            </div>
          </div>

          <div className="goal-body">
            {loading ? (
              <div className="goal-empty">Loading…</div>
            ) : !halfPeriod ? (
              <div className="goal-empty-state">
                <p className="goal-empty-label">No goals for {selectedYear} H{selectedHalf}</p>
                <button className="goal-init-btn" onClick={handleCreatePeriod}>
                  Initialize {selectedYear} H{selectedHalf}
                </button>
              </div>
            ) : (
              <PeriodContent period={halfPeriod} onUpdate={updatePeriod} />
            )}
          </div>
        </div>

        <div className="goal-general-column">
          <div className="goal-period-bar goal-general-bar">
            <span className="goal-general-label">General goals</span>
          </div>

          <div className="goal-body">
            {loading || !generalPeriod ? (
              <div className="goal-empty">Loading…</div>
            ) : (
              <PeriodContent period={generalPeriod} onUpdate={updatePeriod} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface PeriodContentProps {
  period: GoalPeriod
  onUpdate: (p: GoalPeriod) => void
}

function PeriodContent({ period, onUpdate }: PeriodContentProps) {
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const catInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addingCategory) catInputRef.current?.focus()
  }, [addingCategory])

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault()
    if (!newCatName.trim()) return
    try {
      const cat = await api.goals.createCategory(period.id, newCatName.trim())
      onUpdate({ ...period, categories: [...period.categories, cat] })
      setNewCatName('')
      setAddingCategory(false)
    } catch (e) { console.error(e) }
  }

  function updateCategory(updated: GoalCategory) {
    onUpdate({ ...period, categories: period.categories.map(c => c.id === updated.id ? updated : c) })
  }

  async function handleDeleteCategory(catId: string) {
    try {
      await api.goals.deleteCategory(catId)
      onUpdate({ ...period, categories: period.categories.filter(c => c.id !== catId) })
    } catch (e) { console.error(e) }
  }

  return (
    <div className="goal-period-content">
      {period.categories.map(cat => (
        <CategoryBlock
          key={cat.id}
          category={cat}
          onUpdate={updateCategory}
          onDelete={() => handleDeleteCategory(cat.id)}
        />
      ))}

      {addingCategory ? (
        <form className="goal-add-cat-form" onSubmit={handleAddCategory}>
          <input
            ref={catInputRef}
            className="goal-cat-input"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            placeholder="Category name"
            onKeyDown={e => { if (e.key === 'Escape') { setAddingCategory(false); setNewCatName('') } }}
          />
          <button type="submit" className="goal-add-confirm">Add</button>
          <button type="button" className="goal-add-cancel" onClick={() => { setAddingCategory(false); setNewCatName('') }}>Cancel</button>
        </form>
      ) : (
        <button className="goal-add-cat-btn" onClick={() => setAddingCategory(true)}>
          + Add category
        </button>
      )}
    </div>
  )
}

interface CategoryBlockProps {
  category: GoalCategory
  onUpdate: (c: GoalCategory) => void
  onDelete: () => void
}

function CategoryBlock({ category, onUpdate, onDelete }: CategoryBlockProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(category.name)
  const [addingItem, setAddingItem] = useState(false)
  const [newItemText, setNewItemText] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const itemRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editingName) nameRef.current?.focus() }, [editingName])
  useEffect(() => { if (addingItem) itemRef.current?.focus() }, [addingItem])

  async function saveName() {
    if (!nameVal.trim() || nameVal === category.name) { setEditingName(false); setNameVal(category.name); return }
    try {
      const updated = await api.goals.updateCategory(category.id, nameVal.trim())
      onUpdate({ ...category, name: updated.name })
      setEditingName(false)
    } catch (e) { console.error(e) }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newItemText.trim()) return
    try {
      const item = await api.goals.createItem(category.id, newItemText.trim())
      onUpdate({ ...category, items: [...category.items, item] })
      setNewItemText('')
    } catch (e) { console.error(e) }
  }

  function updateItem(updated: GoalItem) {
    onUpdate({ ...category, items: category.items.map(i => i.id === updated.id ? updated : i) })
  }

  async function handleDeleteItem(itemId: string) {
    try {
      await api.goals.deleteItem(itemId)
      onUpdate({ ...category, items: category.items.filter(i => i.id !== itemId) })
    } catch (e) { console.error(e) }
  }

  return (
    <div className="goal-category">
      <div className="goal-cat-header">
        {editingName ? (
          <input
            ref={nameRef}
            className="goal-cat-name-input"
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameVal(category.name) } }}
          />
        ) : (
          <button className="section-label goal-cat-name-btn" onClick={() => setEditingName(true)}>
            {category.name}
          </button>
        )}
        <button className="goal-cat-delete icon-btn" onClick={onDelete} title="Delete category">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="goal-items">
        {category.items.map(item => (
          <GoalItemRow
            key={item.id}
            item={item}
            onUpdate={updateItem}
            onDelete={() => handleDeleteItem(item.id)}
          />
        ))}

        {addingItem ? (
          <form className="goal-add-item-form" onSubmit={handleAddItem}>
            <input
              ref={itemRef}
              className="goal-item-input"
              value={newItemText}
              onChange={e => setNewItemText(e.target.value)}
              placeholder="New goal item"
              onKeyDown={e => { if (e.key === 'Escape') { setAddingItem(false); setNewItemText('') } }}
            />
            <button type="submit" className="goal-add-confirm">Add</button>
            <button type="button" className="goal-add-cancel" onClick={() => { setAddingItem(false); setNewItemText('') }}>Cancel</button>
          </form>
        ) : (
          <button className="goal-add-item-btn" onClick={() => setAddingItem(true)}>
            + Add item
          </button>
        )}
      </div>
    </div>
  )
}

interface GoalItemRowProps {
  item: GoalItem
  onUpdate: (i: GoalItem) => void
  onDelete: () => void
}

function GoalItemRow({ item, onUpdate, onDelete }: GoalItemRowProps) {
  const [noteVal, setNoteVal] = useState(item.note ?? '')

  async function toggleCompleted() {
    try {
      const updated = await api.goals.updateItem(item.id, { completed: !item.completed })
      onUpdate(updated)
    } catch (e) { console.error(e) }
  }

  async function toggleCrossedOut() {
    try {
      const updated = await api.goals.updateItem(item.id, { crossed_out: !item.crossed_out })
      onUpdate(updated)
    } catch (e) { console.error(e) }
  }

  async function saveNote() {
    const note = noteVal.trim() || null
    if (note === (item.note ?? null)) return
    try {
      const updated = await api.goals.updateItem(item.id, { note })
      onUpdate(updated)
    } catch (e) { console.error(e) }
  }

  return (
    <div className={`goal-item${item.completed ? ' goal-item-done' : ''}${item.crossed_out ? ' goal-item-crossed' : ''}`}>
      <label className="goal-item-check">
        <input
          type="checkbox"
          checked={item.completed}
          onChange={toggleCompleted}
        />
        <span className="goal-check-box" />
      </label>

      <div className="goal-item-body">
        <span className={`goal-item-text${item.crossed_out ? ' goal-text-strike' : ''}`}>
          {item.text}
        </span>
        <input
          className="goal-note-input"
          value={noteVal}
          onChange={e => setNoteVal(e.target.value)}
          placeholder="Add comment…"
          onBlur={saveNote}
          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
        />
      </div>

      <div className="goal-item-actions">
        {!item.completed && (
          <button
            className={`goal-action-btn${item.crossed_out ? ' goal-action-active' : ''}`}
            onClick={toggleCrossedOut}
            title={item.crossed_out ? 'Remove strikethrough' : 'Strike through'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 12H3.75m16.5 0H12m0 0V3.75M12 12v8.25M6.75 5.25l10.5 13.5" />
            </svg>
          </button>
        )}
        <button className="goal-action-btn goal-action-delete" onClick={onDelete} title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
