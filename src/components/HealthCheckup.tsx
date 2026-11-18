import type { HealthReport, HealthReportMetric } from '../types'

const MASK = '••••'

// Test groups for everything that is not a headline number.
const SECTIONS: Record<string, string> = {
  body: 'Body',
  vitals: 'Vitals',
  senses: 'Eyes and ears',
  cbc: 'Blood count',
  wbc_diff: 'White cell differential',
  liver: 'Liver',
  serology: 'Hepatitis and serology',
  lipid: 'Lipids',
  endocrine: 'Glucose, pancreas, thyroid, hormones',
  kidney: 'Kidney and electrolytes',
  urine: 'Urine',
  vitamin: 'Vitamin D',
  tumor: 'Tumor markers',
  exams: 'Imaging and function tests',
  inbody: 'Body composition (InBody)',
  allergy: 'Allergy',
  risk: 'Risk and lifestyle',
}

// The headline numbers shown as cards under the findings. 'bp' is one card made of the two pressures.
const KEY_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Body', keys: ['height', 'weight', 'bmi', 'body_fat_pct', 'waist'] },
  { title: 'Vitals', keys: ['bp', 'heart_rate'] },
  { title: 'Body composition', keys: ['inbody_score', 'skeletal_muscle_mass', 'body_fat_mass', 'visceral_fat_area', 'smi', 'bmr'] },
]

function num(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

function valueText(m: HealthReportMetric): string {
  if (m.value == null) return m.text ?? '—'
  return `${num(m.value)}${m.unit ? ` ${m.unit}` : ''}${m.text ? ` · ${m.text}` : ''}`
}

function rangeText(m: HealthReportMetric): string {
  if (m.refLow != null && m.refHigh != null) return `${m.refLow}–${m.refHigh}`
  if (m.refHigh != null) return `≤ ${m.refHigh}`
  if (m.refLow != null) return `≥ ${m.refLow}`
  return m.refText ?? ''
}

function Flag({ flag }: { flag: 'H' | 'L' | null }) {
  if (!flag) return null
  return <b className="ck-flag" aria-label={flag === 'H' ? 'above range' : 'below range'}>{flag === 'H' ? '↑' : '↓'}</b>
}

function Row({ m, hide }: { m: HealthReportMetric; hide: boolean }) {
  return (
    <li className={m.flag && !hide ? 'ck-flagged' : undefined}>
      <span>{m.label}</span>
      <span>
        {hide ? MASK : valueText(m)}
        {!hide && <Flag flag={m.flag} />}
        {!hide && rangeText(m) && <small className="ck-range">{rangeText(m)}</small>}
      </span>
    </li>
  )
}

interface Card { id: string; label: string; value: string; unit: string | null; range: string; flag: 'H' | 'L' | null }

function cardOf(m: HealthReportMetric): Card {
  return {
    id: m.key, label: m.label, flag: m.flag, range: rangeText(m),
    value: m.value != null ? num(m.value) : m.text ?? '—',
    unit: m.value != null ? m.unit : null,
  }
}

// Systolic and diastolic as one card, "117 / 61 mmHg".
function pressureCard(sbp: HealthReportMetric | undefined, dbp: HealthReportMetric | undefined): Card | null {
  if (!sbp && !dbp) return null
  const part = (m: HealthReportMetric | undefined) => (m?.value != null ? num(m.value) : '—')
  return {
    id: 'bp', label: 'Blood pressure', unit: sbp?.unit ?? dbp?.unit ?? null, flag: sbp?.flag ?? dbp?.flag ?? null,
    value: `${part(sbp)} / ${part(dbp)}`,
    range: [sbp, dbp].map(m => (m ? rangeText(m) : '')).filter(Boolean).join(' / '),
  }
}

function StatCard({ c, hide }: { c: Card; hide: boolean }) {
  return (
    <div className={`assets-stat ck-stat${c.flag && !hide ? ' ck-stat-flag' : ''}`}>
      <span className="assets-stat-label">{c.label}</span>
      <span className="assets-stat-value">
        {hide ? MASK : c.value}
        {!hide && c.unit && <small className="ck-unit">{c.unit}</small>}
        {!hide && <Flag flag={c.flag} />}
      </span>
      {!hide && c.range && <small className="ck-range">{c.range}</small>}
    </div>
  )
}

interface HealthCheckupProps {
  report: HealthReport
  hide: boolean
}

// Latest health-checkup results. Order: the doctor's findings, the headline numbers (body, vitals,
// body composition) as cards, then the other results outside the reference range and every other
// test group collapsed. Values, range markers and the names of out-of-range results are all
// masked together with the rest of the tab.
export default function HealthCheckup({ report, hide }: HealthCheckupProps) {
  const byKey = new Map(report.metrics.map(m => [m.key, m]))
  const shown = new Set<string>()
  const keyGroups = KEY_GROUPS.map(g => {
    const cards: Card[] = []
    for (const key of g.keys) {
      if (key === 'bp') {
        const c = pressureCard(byKey.get('sbp'), byKey.get('dbp'))
        if (c) { cards.push(c); shown.add('sbp'); shown.add('dbp') }
      } else if (byKey.has(key)) {
        cards.push(cardOf(byKey.get(key)!)); shown.add(key)
      }
    }
    return { title: g.title, cards }
  }).filter(g => g.cards.length > 0)

  const rest = report.metrics.filter(m => !shown.has(m.key))
  const flagged = rest.filter(m => m.flag)
  const known = Object.keys(SECTIONS)
  const groups = [
    ...known.map(key => ({ key, title: SECTIONS[key], rows: rest.filter(m => m.section === key) })),
    { key: 'other', title: 'Other', rows: rest.filter(m => !known.includes(m.section)) },
  ].filter(g => g.rows.length > 0)
  const date = new Date(report.examDate).toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric' })

  return (
    <div className="assets-section ck-section">
      <div className="section-label">Checkup · {hide ? MASK : date}</div>
      {!hide && report.judgement && (
        <p className="sleep-times">{report.judgement}{report.institution ? ` · ${report.institution}` : ''}</p>
      )}

      {report.findings.length > 0 && (
        <ul className="ck-findings">
          {report.findings.map((f, i) => (
            <li key={`${i}:${f.title}`}>
              <span className="ck-level">{hide ? MASK : f.level === 'follow_up' ? 'Follow up' : 'Advice'}</span>
              <span className="ck-title">{hide ? MASK : f.title}</span>
              {!hide && f.detail && <span className="ck-detail">{f.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {keyGroups.length > 0 && (
        <div className="ck-key">
          {keyGroups.map(g => (
            <div key={g.title} className="ck-keygroup">
              <div className="ck-sub">{g.title}</div>
              <div className="assets-stat-grid">{g.cards.map(c => <StatCard key={c.id} c={c} hide={hide} />)}</div>
            </div>
          ))}
        </div>
      )}

      <div className={`ck-cols${hide ? ' ck-masked' : ''}`}>
        <div className="ck-col">
          {!hide && flagged.length > 0 && (
            <>
              <div className="ck-sub">Other results outside the range</div>
              <ul className="assets-category-list ck-list">{flagged.map(m => <Row key={`${m.section}:${m.key}`} m={m} hide={hide} />)}</ul>
            </>
          )}
        </div>
        <div className="ck-col">
          {groups.map(g => (
            <details key={g.key} className="ck-group">
              <summary>{g.title}<span>{g.rows.length}</span></summary>
              <ul className="assets-category-list ck-list">{g.rows.map(m => <Row key={`${m.section}:${m.key}`} m={m} hide={hide} />)}</ul>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}
