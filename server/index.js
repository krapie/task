import express from 'express'
import cookieParser from 'cookie-parser'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID, createHash } from 'crypto'
import fetch from 'node-fetch'

const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me'
const TASK_USERNAME = process.env.TASK_USERNAME || 'admin'
const TASK_PASSWORD = process.env.TASK_PASSWORD || ''
const MAIL_BRIDGE_URL = process.env.MAIL_BRIDGE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL })

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      slot TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_additions (
      id TEXT PRIMARY KEY,
      slot_date TEXT NOT NULL,
      text TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT false,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template_completions (
      template_id TEXT NOT NULL,
      slot_date TEXT NOT NULL,
      PRIMARY KEY (template_id, slot_date)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      time TEXT,
      recurrence TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_completions (
      event_id TEXT NOT NULL,
      slot_date TEXT NOT NULL,
      PRIMARY KEY (event_id, slot_date)
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      event TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS news_saved (
      link TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      published TEXT,
      preview TEXT,
      flagged BOOLEAN NOT NULL DEFAULT true,
      saved_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)
  await pool.query(`
    INSERT INTO settings VALUES ('rotateHour', '6') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('rotateMinute', '0') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('keepBonus', 'false') ON CONFLICT DO NOTHING;
  `)
}

const app = express()
app.use(express.json())
app.use(cookieParser())

// Rate limiting (simple in-memory, sufficient for single-user personal server)
const loginAttempts = new Map()
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
  const now = Date.now()
  const window = 60_000
  const max = 10
  const attempts = (loginAttempts.get(ip) || []).filter(t => now - t < window)
  if (attempts.length >= max) return res.status(429).json({ error: 'Too many attempts' })
  loginAttempts.set(ip, [...attempts, now])
  next()
}
setInterval(() => {
  const now = Date.now()
  for (const [ip, times] of loginAttempts) {
    const fresh = times.filter(t => now - t < 60_000)
    if (fresh.length === 0) loginAttempts.delete(ip)
    else loginAttempts.set(ip, fresh)
  }
}, 60_000)

async function audit(event, req) {
  const ip = req.ip || req.headers['x-forwarded-for'] || null
  const ua = req.headers['user-agent'] || null
  await pool.query('INSERT INTO audit_log (event, ip, user_agent) VALUES ($1, $2, $3)', [event, ip, ua]).catch(() => {})
}

function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// ── Health ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ── Auth ────────────────────────────────────────────────────────────
app.post('/api/auth/login', rateLimit, async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' })
  if (username !== TASK_USERNAME) {
    await audit('login_fail', req)
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  if (!TASK_PASSWORD) return res.status(503).json({ error: 'TASK_PASSWORD not set' })
  const valid = TASK_PASSWORD.startsWith('$2')
    ? await bcrypt.compare(password, TASK_PASSWORD)
    : password === TASK_PASSWORD
  if (!valid) {
    await audit('login_fail', req)
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ username }, JWT_REFRESH_SECRET, { expiresIn: '30d' })
  const hash = createHash('sha256').update(refreshToken).digest('hex')
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await pool.query(
    'INSERT INTO refresh_tokens (token_hash, username, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO NOTHING',
    [hash, username, expires]
  )
  await audit('login_success', req)
  res.cookie('refresh_token', refreshToken, { httpOnly: true, secure: true, sameSite: 'strict', expires })
  res.json({ token })
})

app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' })
  try {
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET)
    const hash = createHash('sha256').update(refreshToken).digest('hex')
    const { rows } = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()',
      [hash]
    )
    if (!rows.length) return res.status(401).json({ error: 'Invalid refresh token' })
    const token = jwt.sign({ username: payload.username }, JWT_SECRET, { expiresIn: '15m' })
    res.json({ token })
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' })
  }
})

app.post('/api/auth/logout', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token
  if (refreshToken) {
    const hash = createHash('sha256').update(refreshToken).digest('hex')
    await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash])
  }
  res.clearCookie('refresh_token')
  res.json({ ok: true })
})

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ username: req.user.username })
})

// ── Templates ───────────────────────────────────────────────────────
app.get('/api/templates', auth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM templates ORDER BY slot, position')
  const grouped = { mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [] }
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(grouped, row.slot)) grouped[row.slot].push(row)
  }
  res.json(grouped)
})

app.post('/api/templates', auth, async (req, res) => {
  const { slot, text } = req.body ?? {}
  const VALID = ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend']
  if (!VALID.includes(slot) || !text?.trim()) return res.status(400).json({ error: 'Invalid slot or text' })
  const { rows: [{ m }] } = await pool.query('SELECT MAX(position) as m FROM templates WHERE slot = $1', [slot])
  const position = (m ?? -1) + 1
  const id = randomUUID()
  const now = Date.now()
  await pool.query('INSERT INTO templates VALUES ($1, $2, $3, $4, $5)', [id, slot, text.trim(), position, now])
  res.json({ id, slot, text: text.trim(), position, created_at: now })
})

app.put('/api/templates/reorder', auth, async (req, res) => {
  const { slot, ids } = req.body ?? {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be array' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE templates SET position = $1 WHERE id = $2 AND slot = $3', [i, ids[i], slot])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  res.json({ ok: true })
})

app.put('/api/templates/:id', auth, async (req, res) => {
  const { text } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
  await pool.query('UPDATE templates SET text = $1 WHERE id = $2', [text.trim(), req.params.id])
  const { rows: [row] } = await pool.query('SELECT * FROM templates WHERE id = $1', [req.params.id])
  res.json(row)
})

app.delete('/api/templates/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM templates WHERE id = $1', [req.params.id])
  await pool.query('DELETE FROM template_completions WHERE template_id = $1', [req.params.id])
  res.json({ ok: true })
})

// ── Daily ───────────────────────────────────────────────────────────
const DAY_TO_SLOT = ['weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'weekend']

app.get('/api/daily/:slotDate', auth, async (req, res) => {
  const { slotDate } = req.params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return res.status(400).json({ error: 'Invalid date' })
  const [y, m, d] = slotDate.split('-').map(Number)
  const slot = DAY_TO_SLOT[new Date(y, m - 1, d).getDay()]
  const { rows: templates } = await pool.query('SELECT * FROM templates WHERE slot = $1 ORDER BY position', [slot])
  const { rows: completionRows } = await pool.query(
    'SELECT template_id FROM template_completions WHERE slot_date = $1', [slotDate]
  )
  const completedIds = new Set(completionRows.map(r => r.template_id))
  const { rows: additions } = await pool.query(
    'SELECT * FROM daily_additions WHERE slot_date = $1 ORDER BY created_at', [slotDate]
  )
  const { rows: ecRows } = await pool.query(
    'SELECT event_id FROM event_completions WHERE slot_date = $1', [slotDate]
  )
  res.json({
    slotDate,
    slot,
    templates: templates.map(t => ({ ...t, completed: completedIds.has(t.id) })),
    additions,
    eventCompletions: ecRows.map(r => r.event_id),
  })
})

app.post('/api/daily/additions', auth, async (req, res) => {
  const { slotDate, text } = req.body ?? {}
  if (!slotDate || !text?.trim()) return res.status(400).json({ error: 'Missing fields' })
  const id = randomUUID()
  const now = Date.now()
  await pool.query('INSERT INTO daily_additions VALUES ($1, $2, $3, false, $4)', [id, slotDate, text.trim(), now])
  res.json({ id, slot_date: slotDate, text: text.trim(), completed: false, created_at: now })
})

app.put('/api/daily/additions/:id', auth, async (req, res) => {
  const { text } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
  await pool.query('UPDATE daily_additions SET text = $1 WHERE id = $2', [text.trim(), req.params.id])
  const { rows: [row] } = await pool.query('SELECT * FROM daily_additions WHERE id = $1', [req.params.id])
  res.json(row)
})

app.delete('/api/daily/additions/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM daily_additions WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

app.post('/api/daily/toggle', auth, async (req, res) => {
  const { type, id, slotDate, completed } = req.body ?? {}
  if (type === 'template') {
    if (completed) {
      await pool.query(
        'INSERT INTO template_completions VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, slotDate]
      )
    } else {
      await pool.query('DELETE FROM template_completions WHERE template_id = $1 AND slot_date = $2', [id, slotDate])
    }
  } else {
    await pool.query('UPDATE daily_additions SET completed = $1 WHERE id = $2', [completed, id])
  }
  res.json({ ok: true })
})

app.get('/api/daily/additions/range', auth, async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'Missing from/to' })
  const { rows } = await pool.query(
    'SELECT * FROM daily_additions WHERE slot_date >= $1 AND slot_date <= $2 ORDER BY slot_date, created_at',
    [from, to]
  )
  res.json(rows)
})

// ── Events ──────────────────────────────────────────────────────────
app.get('/api/events', auth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM events ORDER BY start_date, time')
  res.json(rows)
})

app.post('/api/events', auth, async (req, res) => {
  const { title, start_date, end_date, time, recurrence } = req.body ?? {}
  if (!title?.trim() || !start_date || !end_date) return res.status(400).json({ error: 'Missing fields' })
  if (end_date < start_date) return res.status(400).json({ error: 'end_date before start_date' })
  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    'INSERT INTO events (id, title, start_date, end_date, time, recurrence, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, title.trim(), start_date, end_date, time || null, recurrence || null, now]
  )
  res.json({ id, title: title.trim(), start_date, end_date, time: time || null, recurrence: recurrence || null, created_at: now })
})

app.put('/api/events/:id', auth, async (req, res) => {
  const { title, start_date, end_date, time, recurrence } = req.body ?? {}
  if (!title?.trim() || !start_date || !end_date) return res.status(400).json({ error: 'Missing fields' })
  await pool.query(
    'UPDATE events SET title=$1, start_date=$2, end_date=$3, time=$4, recurrence=$5 WHERE id=$6',
    [title.trim(), start_date, end_date, time || null, recurrence || null, req.params.id]
  )
  const { rows: [row] } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id])
  res.json(row)
})

app.delete('/api/events/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM events WHERE id = $1', [req.params.id])
  await pool.query('DELETE FROM event_completions WHERE event_id = $1', [req.params.id])
  res.json({ ok: true })
})

app.post('/api/events/:id/toggle', auth, async (req, res) => {
  const { slot_date, completed } = req.body ?? {}
  if (!slot_date) return res.status(400).json({ error: 'Missing slot_date' })
  if (completed) {
    await pool.query('INSERT INTO event_completions VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, slot_date])
  } else {
    await pool.query('DELETE FROM event_completions WHERE event_id = $1 AND slot_date = $2', [req.params.id, slot_date])
  }
  res.json({ ok: true })
})

// ── Settings ─────────────────────────────────────────────────────────
app.get('/api/settings', auth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM settings')
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]))
  res.json({
    rotateHour: parseInt(s.rotateHour ?? '6'),
    rotateMinute: parseInt(s.rotateMinute ?? '0'),
    keepBonus: s.keepBonus === 'true',
  })
})

app.put('/api/settings', auth, async (req, res) => {
  const { rotateHour, rotateMinute, keepBonus } = req.body ?? {}
  const upsert = 'INSERT INTO settings VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (rotateHour !== undefined) await client.query(upsert, ['rotateHour', String(rotateHour)])
    if (rotateMinute !== undefined) await client.query(upsert, ['rotateMinute', String(rotateMinute)])
    if (keepBonus !== undefined) await client.query(upsert, ['keepBonus', String(keepBonus)])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  const { rows } = await pool.query('SELECT * FROM settings')
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]))
  res.json({
    rotateHour: parseInt(s.rotateHour),
    rotateMinute: parseInt(s.rotateMinute),
    keepBonus: s.keepBonus === 'true',
  })
})

// ── Export / Import ──────────────────────────────────────────────────
app.get('/api/export', auth, async (_req, res) => {
  const { rows: tRows } = await pool.query('SELECT * FROM templates ORDER BY slot, position')
  const grouped = { mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [] }
  for (const t of tRows) {
    if (Object.prototype.hasOwnProperty.call(grouped, t.slot)) grouped[t.slot].push(t)
  }
  const { rows: sRows } = await pool.query('SELECT * FROM settings')
  const s = Object.fromEntries(sRows.map(r => [r.key, r.value]))
  res.json({
    version: 1,
    exported_at: new Date().toISOString(),
    templates: grouped,
    settings: {
      rotateHour: parseInt(s.rotateHour ?? '6'),
      rotateMinute: parseInt(s.rotateMinute ?? '0'),
      keepBonus: s.keepBonus === 'true',
    },
  })
})

app.post('/api/import', auth, async (req, res) => {
  const { data, mode } = req.body ?? {}
  if (!data?.templates) return res.status(400).json({ error: 'Invalid data' })
  const VALID = ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend']
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (mode === 'replace') {
      await client.query('DELETE FROM templates')
      await client.query('DELETE FROM template_completions')
    }
    for (const slot of VALID) {
      for (const t of data.templates[slot] ?? []) {
        if (mode === 'merge') {
          const { rows } = await client.query('SELECT id FROM templates WHERE slot = $1 AND text = $2', [slot, t.text])
          if (rows.length) continue
        }
        await client.query(
          'INSERT INTO templates VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [t.id || randomUUID(), slot, t.text, t.position ?? 0, t.created_at ?? Date.now()]
        )
      }
    }
    if (data.settings) {
      const upsert = 'INSERT INTO settings VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'
      if (data.settings.rotateHour !== undefined) await client.query(upsert, ['rotateHour', String(data.settings.rotateHour)])
      if (data.settings.rotateMinute !== undefined) await client.query(upsert, ['rotateMinute', String(data.settings.rotateMinute)])
      if (data.settings.keepBonus !== undefined) await client.query(upsert, ['keepBonus', String(data.settings.keepBonus)])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  res.json({ ok: true })
})

// ── Mail proxy (forwards to mail-bridge) ────────────────────────────
async function mailProxy(req, res) {
  try {
    const url = `${MAIL_BRIDGE_URL}/internal${req.url.replace('/api/mail', '')}`
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': INTERNAL_API_KEY,
      },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
    })
    const body = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(body)
  } catch {
    res.status(503).json({ error: 'mail-bridge unavailable' })
  }
}

app.get('/api/mail/accounts', auth, mailProxy)
app.post('/api/mail/accounts', auth, mailProxy)
app.delete('/api/mail/accounts/:id', auth, mailProxy)
app.get('/api/mail/items', auth, mailProxy)
app.get('/api/mail/items/:id', auth, mailProxy)
app.post('/api/mail/items/:id/read', auth, mailProxy)
app.post('/api/mail/items/:id/flag', auth, mailProxy)
app.post('/api/mail/sync', auth, mailProxy)

// News flags — persisted in task DB
app.get('/api/news/flagged', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM news_saved WHERE flagged = true ORDER BY saved_at DESC')
  res.json(rows)
})

app.post('/api/news/flag', auth, async (req, res) => {
  const { link, title, author, published, preview } = req.body
  if (!link || !title) return res.status(400).json({ error: 'link and title required' })
  await pool.query(
    `INSERT INTO news_saved (link, title, author, published, preview, flagged)
     VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT (link) DO UPDATE SET flagged = true, title=$2, author=$3, published=$4, preview=$5`,
    [link, title, author ?? null, published ?? null, preview ?? null]
  )
  res.json({ flagged: true })
})

app.post('/api/news/unflag', auth, async (req, res) => {
  const { link } = req.body
  if (!link) return res.status(400).json({ error: 'link required' })
  await pool.query('UPDATE news_saved SET flagged = false WHERE link = $1', [link])
  res.json({ flagged: false })
})

// News — GeekNews Atom feed proxy with 5-min cache
const GEEKNEWS_FEED = 'https://news.hada.io/rss/news'
let newsCache = null
let newsCacheAt = 0

const GN_UA = 'Mozilla/5.0 (compatible; task-app/1.0)'

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function parseAtom(xml) {
  const items = []
  const re = /<entry>([\s\S]*?)<\/entry>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const b = m[1]
    const title = decodeEntities((/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(b)?.[1] ?? '').trim())
    const link = /<link[^>]*rel='alternate'[^>]*href='([^']*)'/.exec(b)?.[1] ?? ''
    const published = /<published>(.*?)<\/published>/.exec(b)?.[1] ?? ''
    const author = /<name>(.*?)<\/name>/.exec(b)?.[1] ?? ''
    if (title && link && !title.startsWith('Show GN:')) items.push({ title, link, published, author, preview: null })
  }
  return items
}

function extractPreview(html) {
  // Find the topic_contents div
  const start = html.indexOf('id=\'topic_contents\'')
  if (start === -1) return null
  const open = html.indexOf('>', start) + 1
  const chunk = html.slice(open, open + 8000)
  // Take only content above the first <hr>
  const hrIdx = chunk.indexOf('<hr')
  const above = hrIdx !== -1 ? chunk.slice(0, hrIdx) : chunk
  // Strip HTML tags and decode entities
  return above
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim() || null
}

async function fetchPreview(link) {
  try {
    const r = await fetch(link, { headers: { 'User-Agent': GN_UA }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    return extractPreview(await r.text())
  } catch {
    return null
  }
}

app.get('/api/news', async (req, res) => {
  const now = Date.now()
  // Fetch flagged state from DB regardless of cache
  const { rows: flaggedRows } = await pool.query('SELECT link FROM news_saved WHERE flagged = true').catch(() => ({ rows: [] }))
  const flaggedSet = new Set(flaggedRows.map(r => r.link))

  if (newsCache && now - newsCacheAt < 5 * 60 * 1000) {
    return res.json(newsCache.map(item => ({ ...item, flagged: flaggedSet.has(item.link) })))
  }
  try {
    const r = await fetch(GEEKNEWS_FEED, { headers: { 'User-Agent': GN_UA } })
    if (!r.ok) return res.status(502).json({ error: 'feed unavailable' })
    const xml = await r.text()
    const items = parseAtom(xml)
    const previews = await Promise.all(items.map(item => fetchPreview(item.link)))
    previews.forEach((p, i) => { items[i].preview = p })
    newsCache = items
    newsCacheAt = now
    res.json(items.map(item => ({ ...item, flagged: flaggedSet.has(item.link) })))
  } catch {
    res.status(502).json({ error: 'feed unavailable' })
  }
})

initDb().then(() => {
  app.listen(PORT, () => console.log(`task-api :${PORT}`))
}).catch(err => {
  console.error('DB init failed:', err)
  process.exit(1)
})
