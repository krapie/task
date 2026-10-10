import { useEffect, useState } from 'react'
import { getNextReset } from '../lib/slots'

// "Resets in 3h 12m" — isolated so its ticking doesn't re-render the whole app.
export function ResetCountdown({ rotateHour, rotateMinute }: { rotateHour: number; rotateMinute: number }) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    function tick() {
      const diff = getNextReset(rotateHour, rotateMinute).getTime() - Date.now()
      if (diff <= 0) { setLabel('Resetting…'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      setLabel(`Resets in ${h > 0 ? `${h}h ` : ''}${m}m`)
    }
    tick()
    const id = setInterval(tick, 20_000)
    return () => clearInterval(id)
  }, [rotateHour, rotateMinute])
  return <span className="board-reset" title="When today's checklist rolls over">{label}</span>
}
