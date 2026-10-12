// Minimal Markdown for agent answers: paragraphs, headings, lists, GFM
// tables, fenced code, inline code/bold/italic and http(s) links. Output is
// React elements only (no innerHTML), because answers can quote untrusted
// data such as log lines or stored URLs.
import { Fragment, type ReactNode } from 'react'

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const [tok] = m
    const key = m.index
    if (m[1]) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{inline(tok.slice(2, -2))}</strong>)
    else if (m[3]) out.push(<em key={key}>{inline(tok.slice(1, -1))}</em>)
    else if (m[4]) {
      const label = tok.slice(1, tok.indexOf(']('))
      out.push(
        <a key={key} className="kp-link" href={m[5]} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = blocks.length

    if (!line.trim()) {
      i++
      continue
    }

    const fence = /^```(\w*)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push(
        <pre key={key} className="md-code">
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <p key={key} className="md-heading">
          {inline(heading[2])}
        </p>,
      )
      i++
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      blocks.push(
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {head.map((h, j) => (
                  <th key={j}>{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, j) => (
                    <td key={j}>{inline(r[j] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const listItem = /^\s*([-*]|\d+\.)\s+/
    if (listItem.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length) {
        if (listItem.test(lines[i])) items.push(lines[i++].replace(listItem, ''))
        // An indented line continues the item above (wrapped text).
        else if (items.length && /^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ' ' + lines[i++].trim()
        else break
      }
      const List = ordered ? 'ol' : 'ul'
      const task = (it: string) => /^\[( |x|X)\]\s+/.exec(it)
      blocks.push(
        <List key={key} className={items.some(task) ? 'md-list md-tasks' : 'md-list'}>
          {items.map((it, j) => {
            const t = task(it)
            if (!t) return <li key={j}>{inline(it)}</li>
            const done = t[1] !== ' '
            return (
              <li key={j} className={done ? 'md-task md-task-done' : 'md-task'}>
                <input type="checkbox" checked={done} disabled aria-label={done ? 'done' : 'to do'} />
                <span>{inline(it.slice(t[0].length))}</span>
              </li>
            )
          })}
        </List>,
      )
      continue
    }

    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```|^#{1,4}\s/.test(lines[i]) &&
      !listItem.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      para.push(lines[i++])
    }
    blocks.push(
      <p key={key}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    )
  }
  return <div className="md">{blocks}</div>
}
