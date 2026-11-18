// "Translate to Korean" for text that arrives in English (an assistant answer, the checkup findings). One button per
// view: useTranslation(texts) asks for all of its texts in one request (task-api POST /api/translate, Haiku) and
// answers are kept for the page's lifetime. Text that is already Korean comes back unchanged. Not remembered between
// views, so a long thread is never translated behind the owner's back.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

const MAX_PIECE = 5000 // characters per piece (the server takes 12000 in one request)
const MAX_REQUEST = 10000
const MAX_ITEMS = 40
const cache = new Map<string, string>() // original text → Korean

// Splits Markdown at blank lines outside fenced code into pieces of about `max`; a table or a code block is never cut.
export function splitMarkdown(text: string, max = MAX_PIECE): string[] {
  const paras: string[] = []
  let cur: string[] = []
  let fence = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const isFence = /^\s*(```|~~~)/.test(line)
    if (isFence) fence = !fence
    if (!fence && !isFence && line.trim() === '') {
      if (cur.length) paras.push(cur.join('\n'))
      cur = []
    } else cur.push(line)
  }
  if (cur.length) paras.push(cur.join('\n'))
  // A paragraph longer than `max` (a huge table or code block) is cut at line breaks, so no piece goes over the server's limit.
  const sized = paras.flatMap(p => {
    if (p.length <= max) return [p]
    const out: string[] = []
    let chunk = ''
    for (const line of p.split('\n')) {
      if (chunk && chunk.length + line.length + 1 > max) {
        out.push(chunk)
        chunk = ''
      }
      chunk = chunk ? `${chunk}\n${line}` : line
    }
    if (chunk) out.push(chunk)
    return out
  })
  const pieces: string[] = []
  let acc = ''
  for (const p of sized) {
    if (acc && acc.length + p.length + 2 > max) {
      pieces.push(acc)
      acc = ''
    }
    acc = acc ? `${acc}\n\n${p}` : p
  }
  if (acc) pieces.push(acc)
  return pieces
}

async function translateMissing(texts: string[]): Promise<void> {
  const pieces = texts.map(t => splitMarkdown(t))
  const flat = [...new Set(pieces.flat())]
  const done = new Map<string, string>()
  let batch: string[] = []
  let size = 0
  const flush = async () => {
    if (!batch.length) return
    const out = await api.translate(batch, 'ko')
    batch.forEach((p, i) => done.set(p, out[i]))
    batch = []
    size = 0
  }
  for (const p of flat) {
    if (batch.length && (size + p.length > MAX_REQUEST || batch.length >= MAX_ITEMS)) await flush()
    batch.push(p)
    size += p.length
  }
  await flush()
  texts.forEach((t, i) => cache.set(t, pieces[i].map(p => done.get(p) ?? p).join('\n\n')))
}

export function useTranslation(texts: string[]) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, setVer] = useState(0)
  const failed = useRef(false)
  const key = JSON.stringify(texts)

  useEffect(() => {
    if (!on || failed.current) return
    const missing = [...new Set(texts)].filter(t => t.trim() && !cache.has(t))
    if (!missing.length) return
    setBusy(true)
    setError('')
    translateMissing(missing)
      .catch((e: Error) => {
        failed.current = true
        setError(e.message)
      })
      .finally(() => {
        setBusy(false)
        setVer(v => v + 1)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key])

  const toggle = useCallback(() => {
    failed.current = false
    setError('')
    setOn(v => !v)
  }, [])
  // The text to show: its Korean version while the translation is on and has arrived.
  const t = (text: string) => (on ? cache.get(text) ?? text : text)
  return { on, busy, error, toggle, t }
}
