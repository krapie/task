import { SLOTS, SLOT_LABELS } from '../lib/slots'
import type { Slot } from '../types'

interface DayTabsProps {
  selected: Slot
  active: Slot
  onChange: (slot: Slot) => void
}

export function DayTabs({ selected, active, onChange }: DayTabsProps) {
  return (
    <div className="day-tabs">
      {SLOTS.map(slot => (
        <button
          key={slot}
          className={`day-tab${selected === slot ? ' active' : ''}`}
          onClick={() => onChange(slot)}
          aria-current={active === slot ? 'date' : undefined}
        >
          {SLOT_LABELS[slot]}
          {active === slot && selected !== slot ? ' ·' : ''}
        </button>
      ))}
    </div>
  )
}
