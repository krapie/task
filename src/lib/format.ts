// Number formats shared by the Overview panels and the Trader tab.

export const won = (n: number) => `${n < 0 ? '-' : ''}₩${Math.abs(Math.round(n)).toLocaleString('en-US')}`

// ₩1.2M / ₩845K for glanceable figures; exact amounts stay in the tabs.
export function wonShort(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e9) return `${sign}₩${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}₩${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e3) return `${sign}₩${Math.round(a / 1e3)}K`
  return `${sign}₩${Math.round(a)}`
}

export const signedWon = (n: number) => `${n > 0 ? '+' : ''}${wonShort(n)}`
// Ratios from ops are fractions (0.0123 is 1.23 %), like the admin Trader tab.
export const pct = (frac: number, digits = 1) => `${(frac * 100).toFixed(digits)}%`
export const signedPct = (frac: number, digits = 1) => `${frac > 0 ? '+' : ''}${(frac * 100).toFixed(digits)}%`
export const num = (n: number | null | undefined, suffix = '') => (n == null ? '—' : `${Math.round(n).toLocaleString('en-US')}${suffix}`)

export function hoursText(h: number | null | undefined): string {
  if (h == null) return '—'
  const total = Math.round(h * 60)
  return `${Math.floor(total / 60)}h ${total % 60}m`
}

export function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(m, 0)}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// "2026-10-25" → "Oct 25"
export function shortDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
