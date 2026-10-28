import type { ReactNode } from 'react'
import { hoursText, shortDate } from '../lib/format'

// Monochrome chart primitives for the Overview and the Trader tab: ink on neutral, flat fills, no gradients.

// The y range of a chart: the data's own range, widened around its middle to at least `minSpan` of the
// value (4% = ±2%), so a move of a fraction of a percent stays a small wiggle instead of filling the box.
export function spanDomain(values: number[], minSpan = 0.04): [number, number] {
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  const mid = (lo + hi) / 2
  const need = Math.abs(mid) * minSpan
  if (hi - lo < need) {
    lo = mid - need / 2
    hi = mid + need / 2
  }
  return [lo, hi]
}

// A trend line that stretches to its box. `fill` shades the area under it at low opacity. Meant for money-like series:
// without min/max the scale is at least ±2% wide (spanDomain), so a near-constant series draws as a gentle line.
export function Spark({ points, fill, className = '', label, min: lo, max: hi }: { points: number[]; fill?: boolean; className?: string; label?: string; min?: number; max?: number }) {
  if (points.length < 2) return <div className={`spark spark-empty ${className}`} aria-hidden="true" />
  // lo / hi share one scale between several lines; without them the scale is the data's, at least ±2% wide.
  const [dlo, dhi] = spanDomain(points)
  const min = lo ?? dlo
  const max = hi ?? dhi
  const span = max - min || 1
  const W = 100
  const H = 30
  const xy = points.map((v, i) => [(i / (points.length - 1)) * W, H - 2 - ((v - min) / span) * (H - 4)] as const)
  const line = xy.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  return (
    <svg className={`spark ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {fill && <polygon points={`0,${H} ${line} ${W},${H}`} fill="currentColor" opacity="0.08" />}
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Hours slept per night over the last `days` nights, one bar per calendar day ending on the newest night, so a
// night without a record shows as a gap. Bars start at zero; the dashed line is the average. The newest bar is ink.
export function NightBars({ nights, avg, days = 14, axis, label }: { nights: { night: string; asleepH: number | null }[]; avg?: number | null; days?: number; axis?: boolean; label?: string }) {
  if (!nights.length) return null
  const end = nights[nights.length - 1].night.slice(0, 10)
  const byDate = new Map(nights.map(n => [n.night.slice(0, 10), n.asleepH]))
  const slots = Array.from({ length: days }, (_, i) => {
    const d = new Date(`${end}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - (days - 1 - i))
    const key = d.toISOString().slice(0, 10)
    return { key, v: byDate.get(key) ?? null }
  })
  const top = Math.max(9, ...slots.map(s => s.v ?? 0))
  return (
    <div className="nightbars">
      <div className="nightbars-bars" role="img" aria-label={label}>
        {slots.map((s, i) => (
          <span key={s.key} className="nightbars-col" title={`${shortDate(s.key)}: ${hoursText(s.v)}`}>
            <span className={`nightbars-bar${i === slots.length - 1 ? ' nightbars-last' : ''}${s.v == null ? ' nightbars-gap' : ''}`} style={s.v == null ? undefined : { height: `${(s.v / top) * 100}%` }} />
          </span>
        ))}
        {avg != null && <i className="nightbars-avg" style={{ bottom: `${(avg / top) * 100}%` }} aria-hidden="true" />}
      </div>
      {axis && <div className="nightbars-axis"><span>{shortDate(slots[0].key)}</span><span>{shortDate(slots[slots.length - 1].key)}</span></div>}
    </div>
  )
}

// A progress ring; the centre takes any content (a number, a label).
export function Ring({ value, max, size = 76, stroke = 6, children, label }: { value: number; max: number; size?: number; stroke?: number; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="ring" style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--kp-border)" strokeWidth={stroke} />
        {f > 0 && <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--kp-fg)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray var(--kp-dur-base) var(--kp-ease)' }}
        />}
      </svg>
      <div className="ring-centre">{children}</div>
    </div>
  )
}

const SHADES = ['var(--kp-fg)', 'var(--kp-fg-2)', 'var(--kp-fg-3)', 'var(--kp-fg-4)', 'var(--kp-border-strong)']

// One bar split into shares, darkest first. A legend lists them under it.
export function SplitBar({ parts, legend = true }: { parts: { label: string; value: number }[]; legend?: boolean }) {
  const total = parts.reduce((t, p) => t + Math.max(p.value, 0), 0)
  if (!total) return null
  return (
    <div className="splitbar">
      <div className="splitbar-track" aria-hidden="true">
        {parts.map((p, i) => p.value > 0 && <span key={p.label} style={{ flex: p.value, background: SHADES[Math.min(i, SHADES.length - 1)] }} />)}
      </div>
      {legend && (
        <ul className="splitbar-legend">
          {parts.map((p, i) => p.value > 0 && (
            <li key={p.label}><i style={{ background: SHADES[Math.min(i, SHADES.length - 1)] }} />{p.label} <b>{Math.round((p.value / total) * 100)}%</b></li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Two amounts compared on one scale (income and expense).
export function PairBars({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1)
  return (
    <div className="pairbars">
      {rows.map((r, i) => (
        <div key={r.label} className="pairbars-row">
          <span className="pairbars-label">{r.label}</span>
          <span className="pairbars-track"><span style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: i === 0 ? 'var(--kp-fg)' : 'var(--kp-fg-3)' }} /></span>
          <span className="pairbars-value">{r.display}</span>
        </div>
      ))}
    </div>
  )
}
