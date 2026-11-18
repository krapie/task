import type { HealthReport, HealthReportMetric } from '../types'

const MASK = '••••'

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

function valueText(m: HealthReportMetric): string {
  if (m.value == null) return m.text ?? '—'
  const num = m.value.toLocaleString('en-US', { maximumFractionDigits: 3 })
  return `${num}${m.unit ? ` ${m.unit}` : ''}${m.text ? ` · ${m.text}` : ''}`
}

function rangeText(m: HealthReportMetric): string {
  if (m.refLow != null && m.refHigh != null) return `${m.refLow}–${m.refHigh}`
  if (m.refHigh != null) return `≤ ${m.refHigh}`
  if (m.refLow != null) return `≥ ${m.refLow}`
  return m.refText ?? ''
}

function Row({ m, hide }: { m: HealthReportMetric; hide: boolean }) {
  return (
    <li className={m.flag && !hide ? 'ck-flagged' : undefined}>
      <span>{m.label}</span>
      <span>
        {hide ? MASK : valueText(m)}
        {!hide && m.flag && <b className="ck-flag" aria-label={m.flag === 'H' ? 'above range' : 'below range'}>{m.flag === 'H' ? '↑' : '↓'}</b>}
        {!hide && rangeText(m) && <small className="ck-range">{rangeText(m)}</small>}
      </span>
    </li>
  )
}

interface HealthCheckupProps {
  report: HealthReport
  hide: boolean
}

// Latest health-checkup results: the doctor's findings first, then everything outside the
// reference range, then each test group collapsed. Values are masked with the rest of the tab.
export default function HealthCheckup({ report, hide }: HealthCheckupProps) {
  const flagged = report.metrics.filter(m => m.flag)
  const known = Object.keys(SECTIONS)
  const groups = [
    ...known.map(key => ({ key, title: SECTIONS[key], rows: report.metrics.filter(m => m.section === key) })),
    { key: 'other', title: 'Other', rows: report.metrics.filter(m => !known.includes(m.section)) },
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

      <div className={`ck-cols${hide ? ' ck-masked' : ''}`}>
        <div className="ck-col">
          {!hide && flagged.length > 0 && (
            <>
              <div className="ck-sub">Outside the reference range</div>
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
