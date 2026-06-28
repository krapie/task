import { useState, useEffect, useRef } from 'react'
import type { TemplateWithState, Addition, Template, Slot } from '../types'
import { formatDayLabel, getNextReset, SLOT_LABELS } from '../lib/slots'

interface QuestBoardProps {
  slot: Slot
  slotDate: string
  isActive: boolean
  templates: TemplateWithState[] | Template[]
  additions: Addition[]
  rotateHour: number
  rotateMinute: number
  onToggleTemplate: (id: string) => void
  onAddTemplate: (text: string) => void
  onDeleteTemplate: (id: string) => void
  onMoveTemplate: (id: string, dir: -1 | 1) => void
  onAddAddition: (text: string) => void
  onDeleteAddition: (id: string) => void
  onToggleAddition: (id: string) => void
}

function useCountdown(rotateHour: number, rotateMinute: number) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    function tick() {
      const next = getNextReset(rotateHour, rotateMinute)
      const diff = next.getTime() - Date.now()
      if (diff <= 0) { setLabel('resetting…'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setLabel(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} to reset`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [rotateHour, rotateMinute])

  return label
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  )
}

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function submit() {
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <div className="add-quest">
      <input
        ref={inputRef}
        className="add-quest-input"
        placeholder={placeholder}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
      <button className="add-quest-btn" onClick={submit}>Add</button>
    </div>
  )
}

export function QuestBoard({
  slot,
  slotDate,
  isActive,
  templates,
  additions,
  rotateHour,
  rotateMinute,
  onToggleTemplate,
  onAddTemplate,
  onDeleteTemplate,
  onMoveTemplate,
  onAddAddition,
  onDeleteAddition,
  onToggleAddition,
}: QuestBoardProps) {
  const countdown = useCountdown(rotateHour, rotateMinute)

  const activeTemplates = templates as TemplateWithState[]
  const completedCount = isActive
    ? activeTemplates.filter(t => t.completed).length + additions.filter(a => a.completed).length
    : 0
  const totalCount = isActive ? templates.length + additions.length : 0

  return (
    <div>
      <div className="slot-header">
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--kp-text-base)', color: 'var(--kp-fg)' }}>
            {isActive ? formatDayLabel(slotDate) : SLOT_LABELS[slot]}
          </div>
          {isActive && <div className="slot-date">{slotDate}</div>}
        </div>
        <div className="slot-meta">
          {isActive && totalCount > 0 && (
            <span className="progress-label">{completedCount} / {totalCount}</span>
          )}
          {isActive && <span className="reset-countdown">{countdown}</span>}
        </div>
      </div>

      {/* Daily Quests (Templates) */}
      <div className="quest-section">
        <div className="section-label">Daily Quests</div>
        {templates.length > 0 ? (
          <div className="quest-list">
            {templates.map((t, i) => {
              const done = isActive ? (t as TemplateWithState).completed : false
              return (
                <div key={t.id} className="quest-item">
                  {isActive ? (
                    <button
                      className={`quest-checkbox${done ? ' checked' : ''}`}
                      onClick={() => onToggleTemplate(t.id)}
                      aria-label={done ? 'Mark incomplete' : 'Mark complete'}
                    >
                      <CheckIcon />
                    </button>
                  ) : (
                    <div style={{ width: 16, height: 16, border: '1.5px solid var(--kp-border)', borderRadius: 'var(--kp-radius-sm)', flexShrink: 0 }} />
                  )}
                  <span className={`quest-text${done ? ' done' : ''}`}>{t.text}</span>
                  <div className="quest-reorder">
                    <button
                      className="quest-reorder-btn"
                      onClick={() => onMoveTemplate(t.id, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      <ChevronUpIcon />
                    </button>
                    <button
                      className="quest-reorder-btn"
                      onClick={() => onMoveTemplate(t.id, 1)}
                      disabled={i === templates.length - 1}
                      aria-label="Move down"
                    >
                      <ChevronDownIcon />
                    </button>
                  </div>
                  <button className="quest-delete" onClick={() => onDeleteTemplate(t.id)} aria-label="Delete">
                    <TrashIcon />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">No daily quests yet. Add one below.</div>
        )}
        <AddInput
          placeholder={`Add daily quest for ${SLOT_LABELS[slot]}…`}
          onAdd={onAddTemplate}
        />
      </div>

      {/* Bonus Quests (only for active slot) */}
      {isActive && (
        <div className="quest-section">
          <div className="section-label">Bonus Quests</div>
          {additions.length > 0 ? (
            <div className="quest-list">
              {additions.map(a => (
                <div key={a.id} className="quest-item">
                  <button
                    className={`quest-checkbox${a.completed ? ' checked' : ''}`}
                    onClick={() => onToggleAddition(a.id)}
                    aria-label={a.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    <CheckIcon />
                  </button>
                  <span className={`quest-text${a.completed ? ' done' : ''}`}>{a.text}</span>
                  <button className="quest-delete" onClick={() => onDeleteAddition(a.id)} aria-label="Delete">
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No bonus quests for today.</div>
          )}
          <AddInput placeholder="Add bonus quest for today…" onAdd={onAddAddition} />
        </div>
      )}
    </div>
  )
}
