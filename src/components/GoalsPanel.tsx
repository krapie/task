import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { notifyError } from '../lib/notify'
import type { GoalPeriod } from '../types'
import { PeriodContent, currentHalf } from './GoalView'
import { Empty, Loading } from './Ui'

// Routine side panel (wide windows, signed in): this half-year's goals, editable in place.
// The full Goals view (General | Year | Half) stays one click away.
export function GoalsPanel({ onOpenAll }: { onOpenAll: () => void }) {
  const { year, half } = currentHalf()
  const [periods, setPeriods] = useState<GoalPeriod[] | null>(null)

  useEffect(() => {
    api.goals.getAll().then(setPeriods).catch(e => { notifyError(e); setPeriods([]) })
  }, [])

  const period = periods?.find(p => p.kind === 'half' && p.year === year && p.half === half) ?? null
  const label = `H${half} ${year}`

  async function start() {
    try {
      const created = await api.goals.createPeriod(year, half)
      setPeriods(prev => [created, ...(prev ?? [])])
    } catch (e) { notifyError(e) }
  }

  return (
    <aside className="goals-panel" aria-label="Goals">
      <div className="goals-panel-head">
        <span className="section-label">Goals · {label}</span>
        <button type="button" className="btn-ghost btn-sm" onClick={onOpenAll}>All goals</button>
      </div>
      {periods === null ? (
        <Loading rows={3} />
      ) : period ? (
        <PeriodContent period={period} onUpdate={u => setPeriods(prev => (prev ?? []).map(p => (p.id === u.id ? u : p)))} />
      ) : (
        <Empty compact icon="flag" title={`No goals for ${label}`} hint="Start a list to track what you want to get done." action={{ label: `Start ${label}`, onClick: start }} />
      )}
    </aside>
  )
}
