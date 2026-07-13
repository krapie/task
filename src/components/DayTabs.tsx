import type { Slot } from '../types'

interface DayTabsProps {
  selected: Slot
  active: Slot
  onChange: (slot: Slot) => void
  slotLabels: Record<Slot, string>
  slotOrder: Slot[]
}

export function DayTabs({ selected, active, onChange, slotLabels, slotOrder }: DayTabsProps) {
  return (
    <div className="day-tabs">
      {slotOrder.map(slot => (
        <button
          key={slot}
          className={`day-tab${selected === slot ? ' active' : ''}`}
          onClick={() => onChange(slot)}
          aria-current={active === slot ? 'date' : undefined}
        >
          {slotLabels[slot]}
          {active === slot && selected !== slot ? ' ·' : ''}
        </button>
      ))}
    </div>
  )
}
