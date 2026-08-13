import express from 'express'
import cookieParser from 'cookie-parser'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID, createHash, createHmac } from 'crypto'
import fetch from 'node-fetch'
import webpush from 'web-push'
import { load as loadHtml } from 'cheerio'

const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me'
const TASK_USERNAME = process.env.TASK_USERNAME || 'admin'
const TASK_PASSWORD = process.env.TASK_PASSWORD || ''
const MAIL_BRIDGE_URL = process.env.MAIL_BRIDGE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''
const AGENTQ_URL = process.env.AGENTQ_URL || 'http://192.168.0.17:8888'
const AGENTQ_JWT_SECRET = process.env.AGENTQ_JWT_SECRET || ''
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const TRANSLATE_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TRANSLATE_CHARS = 8000
// Higher than MAX_TRANSLATE_CHARS because this only counts actual text-node
// content (markup, scripts, styles already excluded), so the same cap would
// be needlessly strict here.
const MAX_HTML_TRANSLATE_CHARS = 12000

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function signAgentqJwt(sub) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ sub: sub || 'task', aud: 'agentq', iss: 'task', exp: Math.floor(Date.now() / 1000) + 60 }))
  const sig = b64url(createHmac('sha256', AGENTQ_JWT_SECRET).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL })

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      slot TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      group_id UUID DEFAULT NULL,
      created_at BIGINT NOT NULL
    );
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS group_id UUID DEFAULT NULL;
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
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT false,
      due_date TEXT,
      group_id UUID DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE todos ADD COLUMN IF NOT EXISTS group_id UUID DEFAULT NULL;
    CREATE TABLE IF NOT EXISTS news_saved (
      link TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      published TEXT,
      preview TEXT,
      flagged BOOLEAN NOT NULL DEFAULT true,
      saved_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS goal_periods (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      half INTEGER NOT NULL CHECK (half IN (1, 2)),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(year, half)
    );
    CREATE TABLE IF NOT EXISTS goal_categories (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES goal_periods(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS goal_items (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES goal_categories(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT false,
      crossed_out BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)
  await pool.query(`
    INSERT INTO settings VALUES ('rotateHour', '6') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('rotateMinute', '0') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('keepBonus', 'false') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('workWeek', 'mon-fri') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('last_mail_push_at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('taskNotifyEnabled', 'false') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('taskNotifyHour', '9') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('taskNotifyMinute', '0') ON CONFLICT DO NOTHING;
    INSERT INTO settings VALUES ('taskNotifyTz', 'UTC') ON CONFLICT DO NOTHING;
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
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '4h' })
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
    const token = jwt.sign({ username: payload.username }, JWT_SECRET, { expiresIn: '4h' })
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

// Link two templates into an OR-group
app.post('/api/templates/:id/link', auth, async (req, res) => {
  const { target_id } = req.body ?? {}
  if (!target_id) return res.status(400).json({ error: 'target_id required' })
  const { rows } = await pool.query('SELECT id, group_id FROM templates WHERE id = ANY($1)', [[req.params.id, target_id]])
  if (rows.length < 2) return res.status(404).json({ error: 'One or both templates not found' })
  const existingGroup = rows.find(r => r.group_id)?.group_id ?? randomUUID()
  await pool.query('UPDATE templates SET group_id = $1 WHERE id = ANY($2)', [existingGroup, [req.params.id, target_id]])
  const { rows: updated } = await pool.query('SELECT * FROM templates WHERE id = ANY($1)', [[req.params.id, target_id]])
  res.json(updated)
})

// Remove a template from its OR-group
app.delete('/api/templates/:id/link', auth, async (req, res) => {
  await pool.query('UPDATE templates SET group_id = NULL WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ── Daily ───────────────────────────────────────────────────────────
const DOW_TO_SLOT_MON_FRI = ['weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'weekend']

app.get('/api/daily/:slotDate', auth, async (req, res) => {
  const { slotDate } = req.params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return res.status(400).json({ error: 'Invalid date' })
  const [y, m, d] = slotDate.split('-').map(Number)
  const slot = DOW_TO_SLOT_MON_FRI[new Date(y, m - 1, d).getDay()]
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
    completionIds: completionRows.map(r => r.template_id),
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
      // Propagate to OR-group members
      const { rows: [tmpl] } = await pool.query('SELECT group_id FROM templates WHERE id = $1', [id])
      let groupCompleted = []
      if (tmpl?.group_id) {
        const { rows: members } = await pool.query(
          'SELECT id FROM templates WHERE group_id = $1 AND id != $2', [tmpl.group_id, id]
        )
        for (const m of members) {
          await pool.query(
            'INSERT INTO template_completions VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.id, slotDate]
          )
        }
        groupCompleted = members.map(m => m.id)
      }
      return res.json({ ok: true, groupCompleted })
    } else {
      await pool.query('DELETE FROM template_completions WHERE template_id = $1 AND slot_date = $2', [id, slotDate])
    }
  } else {
    await pool.query('UPDATE daily_additions SET completed = $1 WHERE id = $2', [completed, id])
  }
  res.json({ ok: true, groupCompleted: [] })
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
    workWeek: s.workWeek ?? 'mon-fri',
    taskNotifyEnabled: s.taskNotifyEnabled === 'true',
    taskNotifyHour: parseInt(s.taskNotifyHour ?? '9'),
    taskNotifyMinute: parseInt(s.taskNotifyMinute ?? '0'),
    taskNotifyTz: s.taskNotifyTz ?? 'UTC',
  })
})

app.put('/api/settings', auth, async (req, res) => {
  const { rotateHour, rotateMinute, keepBonus, workWeek, taskNotifyEnabled, taskNotifyHour, taskNotifyMinute, taskNotifyTz } = req.body ?? {}
  const upsert = 'INSERT INTO settings VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (rotateHour !== undefined) await client.query(upsert, ['rotateHour', String(rotateHour)])
    if (rotateMinute !== undefined) await client.query(upsert, ['rotateMinute', String(rotateMinute)])
    if (keepBonus !== undefined) await client.query(upsert, ['keepBonus', String(keepBonus)])
    if (workWeek !== undefined) await client.query(upsert, ['workWeek', String(workWeek)])
    if (taskNotifyEnabled !== undefined) await client.query(upsert, ['taskNotifyEnabled', String(taskNotifyEnabled)])
    if (taskNotifyHour !== undefined) await client.query(upsert, ['taskNotifyHour', String(taskNotifyHour)])
    if (taskNotifyMinute !== undefined) await client.query(upsert, ['taskNotifyMinute', String(taskNotifyMinute)])
    if (taskNotifyTz !== undefined) await client.query(upsert, ['taskNotifyTz', String(taskNotifyTz)])
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
    workWeek: s.workWeek ?? 'mon-fri',
    taskNotifyEnabled: s.taskNotifyEnabled === 'true',
    taskNotifyHour: parseInt(s.taskNotifyHour ?? '9'),
    taskNotifyMinute: parseInt(s.taskNotifyMinute ?? '0'),
    taskNotifyTz: s.taskNotifyTz ?? 'UTC',
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
      workWeek: s.workWeek ?? 'mon-fri',
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

// ── Push notifications ───────────────────────────────────────────────
app.get('/api/push/vapid-key', (_req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push not configured' })
  res.json({ key: VAPID_PUBLIC_KEY })
})

app.post('/api/push/subscribe', auth, async (req, res) => {
  const { endpoint, keys } = req.body ?? {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' })
  const id = randomUUID()
  await pool.query(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh=$3, auth=$4`,
    [id, endpoint, keys.p256dh, keys.auth]
  )
  res.json({ ok: true })
})

app.delete('/api/push/unsubscribe', auth, async (req, res) => {
  const { endpoint } = req.body ?? {}
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
  res.json({ ok: true })
})

async function sendPushToAll(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return
  const { rows } = await pool.query('SELECT * FROM push_subscriptions')
  await Promise.all(rows.map(async row => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload)
      )
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint])
      } else {
        console.error('Push send error:', err.message)
      }
    }
  }))
}

async function checkAndPushNewMail() {
  try {
    const { rows: subRows } = await pool.query('SELECT COUNT(*) FROM push_subscriptions')
    if (parseInt(subRows[0].count) === 0) return

    const { rows: [setting] } = await pool.query(`SELECT value FROM settings WHERE key = 'last_mail_push_at'`)
    const since = setting?.value ?? new Date(Date.now() - 6 * 60 * 1000).toISOString()

    const url = `${MAIL_BRIDGE_URL}/internal/items/new?after=${encodeURIComponent(since)}`
    const res = await fetch(url, { headers: { 'X-Internal-Key': INTERNAL_API_KEY } })
    if (!res.ok) return
    const newItems = await res.json()
    if (!newItems.length) return

    // Send one notification per email (Gmail style: sender → title, subject + snippet → body)
    // Use a unique tag per item so notifications stack instead of replacing each other.
    // URL includes ?tab=mail&mail=<id> so tapping opens the specific email directly.
    for (const item of newItems) {
      const title = item.from_name || item.from_address || 'New email'
      const subject = (item.subject || '(no subject)').trim()
      const snippet = item.snippet ? item.snippet.trim().slice(0, 100) : ''
      const body = snippet ? `${subject}\n${snippet}` : subject
      await sendPushToAll({ title, body, tag: `mail-${item.id}`, url: `/?tab=mail&mail=${item.id}` })
    }
    await pool.query(`UPDATE settings SET value = $1 WHERE key = 'last_mail_push_at'`, [new Date().toISOString()])
  } catch (err) {
    console.error('Mail push check error:', err.message)
  }
}

// Background mail push poller (every 5 min, offset by 30s to let bridge sync first)
setTimeout(() => setInterval(checkAndPushNewMail, 5 * 60 * 1000), 30_000)

// ── Task digest push notification ─────────────────────────────────────
// Maps each workWeek variant's 0-6 (Sun-Sat) day index to a slot name.
const DAY_TO_SLOT = {
  'mon-fri': ['weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'weekend'],
  'tue-sat': ['weekend', 'weekend', 'tue', 'wed', 'thu', 'fri', 'mon'],
  'sun-thu': ['mon',     'tue',    'wed', 'thu', 'fri', 'weekend', 'weekend'],
}

// Returns { dateStr: 'YYYY-MM-DD', hour, minute, dow } for a given IANA timezone.
function nowInTz(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
    hour12: false,
  }).formatToParts(new Date())
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  // en-CA date format: YYYY-MM-DD
  const dateStr = `${p.year}-${p.month}-${p.day}`
  const hour = parseInt(p.hour) // 0-23; Intl may return '24' for midnight in some locales
  const minute = parseInt(p.minute)
  // weekday 'short' in en-CA: Sun Mon Tue Wed Thu Fri Sat
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dow = dowMap[p.weekday] ?? 0
  return { dateStr, hour: hour === 24 ? 0 : hour, minute, dow }
}

// Computes the active slot and its anchor date (the date stored in DB for that slot).
function activeSlotInfo(tz, rotateHour, rotateMinute, workWeek) {
  const { dateStr, hour, minute, dow } = nowInTz(tz)
  const nowMins = hour * 60 + minute
  const rotateMins = rotateHour * 60 + rotateMinute
  // If before reset, the "active day" is yesterday
  let activeDow = dow
  let activeDateStr = dateStr
  if (nowMins < rotateMins) {
    const d = new Date(`${dateStr}T12:00:00`) // noon to avoid DST edge
    d.setDate(d.getDate() - 1)
    const prev = nowInTz(tz)  // re-derive yesterday's dow via date arithmetic
    // Compute yesterday's date string directly
    const [y, m, day] = dateStr.split('-').map(Number)
    const yesterday = new Date(y, m - 1, day - 1)
    activeDateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    // dow for yesterday: (dow + 6) % 7
    activeDow = (dow + 6) % 7
  }
  const dayMap = DAY_TO_SLOT[workWeek] ?? DAY_TO_SLOT['mon-fri']
  const slot = dayMap[activeDow]
  // Anchor slotDate: walk back to find the earliest contiguous day with the same slot
  const [ay, am, ad] = activeDateStr.split('-').map(Number)
  let anchorDate = new Date(ay, am - 1, ad)
  for (let i = 1; i <= 6; i++) {
    const prev = new Date(ay, am - 1, ad - i)
    if (dayMap[prev.getDay()] !== slot) break
    anchorDate = prev
  }
  const slotDate = `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}-${String(anchorDate.getDate()).padStart(2, '0')}`
  return { slot, slotDate }
}

async function checkAndPushTasks() {
  try {
    const { rows: subRows } = await pool.query('SELECT COUNT(*) FROM push_subscriptions')
    if (parseInt(subRows[0].count) === 0) return

    const { rows: sRows } = await pool.query('SELECT * FROM settings')
    const s = Object.fromEntries(sRows.map(r => [r.key, r.value]))

    if (s.taskNotifyEnabled !== 'true') return

    const notifyHour = parseInt(s.taskNotifyHour ?? '9')
    const notifyMinute = parseInt(s.taskNotifyMinute ?? '0')
    const tz = s.taskNotifyTz ?? 'UTC'
    const rotateHour = parseInt(s.rotateHour ?? '6')
    const rotateMinute = parseInt(s.rotateMinute ?? '0')
    const workWeek = s.workWeek ?? 'mon-fri'

    const { dateStr: todayStr, hour: curHour, minute: curMinute } = nowInTz(tz)

    // Fire only at the exact configured minute
    if (curHour !== notifyHour || curMinute !== notifyMinute) return
    // Fire only once per day
    if (s.last_task_notify_date === todayStr) return

    const { slot, slotDate } = activeSlotInfo(tz, rotateHour, rotateMinute, workWeek)

    // Incomplete routine templates for this slot
    const { rows: templates } = await pool.query(`
      SELECT t.id, t.text FROM templates t
      WHERE t.slot = $1
        AND NOT EXISTS (
          SELECT 1 FROM template_completions tc
          WHERE tc.template_id = t.id AND tc.slot_date = $2
        )
      ORDER BY t.position
    `, [slot, slotDate])

    // Incomplete bonus additions for this slot date
    const { rows: additions } = await pool.query(
      'SELECT id, text FROM daily_additions WHERE slot_date = $1 AND completed = false ORDER BY created_at',
      [slotDate]
    )

    // Calendar events covering this slot date not yet completed
    const { rows: events } = await pool.query(`
      SELECT e.id, e.title AS text FROM events e
      WHERE e.start_date <= $1 AND e.end_date >= $1
        AND NOT EXISTS (
          SELECT 1 FROM event_completions ec
          WHERE ec.event_id = e.id AND ec.slot_date = $2
        )
      ORDER BY e.time NULLS LAST
    `, [slotDate, slotDate])

    // Todos due today that are incomplete
    const { rows: todos } = await pool.query(
      'SELECT id, text FROM todos WHERE due_date = $1 AND completed = false ORDER BY created_at',
      [slotDate]
    )

    const all = [...templates, ...additions, ...events, ...todos]
    if (all.length === 0) return

    // Format: "Walk · Workout · Read · +N more"
    const MAX_NAMES = 4
    const shown = all.slice(0, MAX_NAMES).map(t => t.text)
    const rest = all.length - shown.length
    const bodyLine = rest > 0
      ? shown.join(' · ') + ` · +${rest} more`
      : shown.join(' · ')

    // Human-friendly date label ("Aug 13")
    const [dy, dm, dd] = slotDate.split('-').map(Number)
    const dateLabel = new Date(dy, dm - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const title = `Today's Tasks — ${dateLabel}`

    await sendPushToAll({ title, body: bodyLine, tag: 'tasks', url: '/?tab=routine' })
    await pool.query(
      `INSERT INTO settings VALUES ('last_task_notify_date', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [todayStr]
    )
  } catch (err) {
    console.error('Task push check error:', err.message)
  }
}

// Check every minute whether it's time to send the task digest
setInterval(checkAndPushTasks, 60_000)

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
app.post('/api/mail/sync', auth, async (req, res) => {
  await mailProxy(req, res)
  // After sync, check for new mail to push (non-blocking)
  checkAndPushNewMail().catch(() => {})
})

// ── Translation helpers ─────────────────────────────────────────────
const TRANSLATE_TARGET_NAME = { ko: 'Korean', en: 'English' }
// Tags whose text content is never user-visible copy (script/style bodies,
// <head> metadata) — skip these when walking text nodes.
const HTML_SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'noscript'])
// Any Unicode letter. Filters out nodes that are pure whitespace, numbers,
// punctuation, or symbols (prices, separators, dates) — nothing worth
// spending tokens translating, and mistranslating a price is worse than
// leaving it alone.
const HAS_LETTER_RE = /\p{L}/u

async function translatePlainText(text, target) {
  const targetName = TRANSLATE_TARGET_NAME[target]
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      max_tokens: 4096,
      system: `Translate the given email body into ${targetName}. Output only the translated text — no preamble, no notes, no explanations. Preserve the original paragraph and line breaks. If the text is already in ${targetName}, return it unchanged.`,
      messages: [{ role: 'user', content: text }],
    }),
  })
  if (!aiRes.ok) {
    console.error('Anthropic translate error:', aiRes.status, await aiRes.text().catch(() => ''))
    return null
  }
  const aiJson = await aiRes.json()
  const translated = (aiJson.content ?? []).map(b => b.text ?? '').join('').trim()
  return translated || null
}

// Translates a batch of text fragments in one call via forced tool use, so
// the model must return a same-length, same-order JSON array instead of
// freeform text we'd have to split back apart (fragile if a translation
// happens to contain whatever delimiter we picked).
//
// De-duplicates before calling the model and maps translations back to every
// occurrence afterward. This isn't just a cost optimization (marketing email
// HTML routinely repeats the same string — a hidden preheader mirroring the
// visible heading, footer boilerplate): a same-length response is only
// guaranteed if we never ask the model to translate the same input twice,
// because it reliably collapses duplicate entries in its output even when
// explicitly told to preserve them 1:1.
async function translateFragments(fragments, target) {
  const targetName = TRANSLATE_TARGET_NAME[target]
  const uniqueFragments = [...new Set(fragments)]
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      max_tokens: 8192,
      system: `You translate email text fragments into ${targetName}. You receive a JSON array of unique text fragments extracted from an HTML email. Call return_translations with an array of the SAME LENGTH, in the SAME ORDER, where each element is the ${targetName} translation of the fragment at that index. Each translation is a literal drop-in replacement for its fragment — don't merge, split, or add commentary. If a fragment is already in ${targetName} or has no translatable content (a code, a name, a URL), return it unchanged.`,
      tools: [{
        name: 'return_translations',
        description: 'Return the translated text fragments',
        input_schema: {
          type: 'object',
          properties: {
            translations: {
              type: 'array',
              items: { type: 'string' },
              description: 'Translations in the same order as the input fragments',
            },
          },
          required: ['translations'],
        },
      }],
      tool_choice: { type: 'tool', name: 'return_translations' },
      messages: [{ role: 'user', content: JSON.stringify(uniqueFragments) }],
    }),
  })
  if (!aiRes.ok) {
    console.error('Anthropic HTML-translate error:', aiRes.status, await aiRes.text().catch(() => ''))
    return null
  }
  const aiJson = await aiRes.json()
  const toolUse = (aiJson.content ?? []).find(b => b.type === 'tool_use')
  const translations = toolUse?.input?.translations
  if (!Array.isArray(translations) || translations.length !== uniqueFragments.length) {
    console.error('HTML translate: shape mismatch from model, falling back')
    return null
  }
  const byFragment = new Map(uniqueFragments.map((f, i) => [f, translations[i]]))
  return fragments.map(f => byFragment.get(f))
}

// Translates only the text nodes of an HTML email, leaving every tag and
// attribute untouched, so the client can render it in an iframe exactly
// like the original — same layout, images, links — with translated copy.
// Returns null (caller falls back to plain-text translation) on anything
// that doesn't look safely reversible: no translatable text, oversized
// content, or a malformed model response.
async function translateHtml(html, target) {
  try {
    const $ = loadHtml(html)
    const nodes = []
    $('*').contents().each((_, el) => {
      if (el.type !== 'text') return
      // htmlparser2 gives <script>/<style> element nodes their own node
      // .type ('script'/'style', not 'tag'), so check .name directly rather
      // than gating on .type === 'tag' — that would let their contents slip
      // through unfiltered.
      const parentTag = el.parent?.name ?? null
      if (parentTag && HTML_SKIP_TAGS.has(parentTag)) return
      if (!el.data || !HAS_LETTER_RE.test(el.data)) return
      nodes.push(el)
    })
    if (!nodes.length) return null

    const totalLen = nodes.reduce((sum, n) => sum + n.data.length, 0)
    if (totalLen > MAX_HTML_TRANSLATE_CHARS) return null

    const fragments = nodes.map(n => n.data)
    const translations = await translateFragments(fragments, target)
    if (!translations) return null

    nodes.forEach((node, i) => {
      // Keep the original fragment's surrounding whitespace so inline
      // spacing (word gaps across <span> boundaries etc.) doesn't collapse.
      const leading = node.data.match(/^\s*/)[0]
      const trailing = node.data.match(/\s*$/)[0]
      node.data = leading + translations[i].trim() + trailing
    })

    return { html: $.html(), plainFallback: translations.join('\n') }
  } catch (err) {
    console.error('HTML translate error:', err.message)
    return null
  }
}

// On-demand email translation (English/Japanese -> Korean, or vice versa).
// Never called from the sync path — only when the user clicks the button —
// so a busy inbox never burns API budget on its own.
app.post('/api/mail/items/:id/translate', auth, async (req, res) => {
  const { target } = req.body ?? {}
  if (target !== 'ko' && target !== 'en') {
    return res.status(400).json({ error: 'target must be "ko" or "en"' })
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Translation is not configured' })
  }
  try {
    const itemRes = await fetch(`${MAIL_BRIDGE_URL}/internal/items/${req.params.id}`, {
      headers: { 'X-Internal-Key': INTERNAL_API_KEY },
    })
    if (!itemRes.ok) return res.status(itemRes.status).json({ error: 'Mail item not found' })
    const item = await itemRes.json()

    if (item.translated_lang === target && (item.translated_html || item.translated_body)) {
      return res.json({
        translated: item.translated_body,
        html: item.translated_html ?? null,
        lang: target,
        cached: true,
      })
    }

    let translated = null
    let html = null

    if (item.html_body) {
      const htmlResult = await translateHtml(item.html_body, target)
      if (htmlResult) {
        html = htmlResult.html
        translated = htmlResult.plainFallback
      }
    }

    // No html_body, or the HTML path bailed out (too big, malformed, model
    // response didn't line up) — fall back to translating the plain body.
    if (!translated) {
      const source = (item.body || '').slice(0, MAX_TRANSLATE_CHARS)
      if (!source.trim()) return res.status(400).json({ error: 'Nothing to translate' })
      translated = await translatePlainText(source, target)
      if (!translated) return res.status(502).json({ error: 'Translation service error' })
    }

    // Cache for next time — best-effort, don't fail the request over it.
    fetch(`${MAIL_BRIDGE_URL}/internal/items/${req.params.id}/translate-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_API_KEY },
      body: JSON.stringify({ lang: target, text: translated, html }),
    }).catch(() => {})

    res.json({ translated, html, lang: target, cached: false })
  } catch (err) {
    console.error('Translate error:', err.message)
    res.status(500).json({ error: 'Translation failed' })
  }
})

// ── Todos ─────────────────────────────────────────────────────────────
app.get('/api/todos', auth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM todos ORDER BY completed ASC, created_at DESC')
  res.json(rows)
})

app.post('/api/todos', auth, async (req, res) => {
  const { text, due_date } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })
  const id = randomUUID()
  const { rows } = await pool.query(
    'INSERT INTO todos (id, text, due_date) VALUES ($1, $2, $3) RETURNING *',
    [id, text.trim(), due_date ?? null]
  )
  res.json(rows[0])
})

app.patch('/api/todos/:id', auth, async (req, res) => {
  const { text, completed, due_date } = req.body ?? {}
  const sets = []
  const params = []
  if (text !== undefined) { params.push(text); sets.push(`text = $${params.length}`) }
  if (completed !== undefined) { params.push(completed); sets.push(`completed = $${params.length}`) }
  if ('due_date' in (req.body ?? {})) { params.push(due_date ?? null); sets.push(`due_date = $${params.length}`) }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' })
  params.push(req.params.id)
  const { rows } = await pool.query(
    `UPDATE todos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

app.delete('/api/todos/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM todos WHERE id = $1', [req.params.id])
  res.json({})
})

// agentq proxy — signs JWT server-side, forwards to agentq host process
function agentqFetch(url, options = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

app.post('/api/agentq/tasks', auth, async (req, res) => {
  if (!AGENTQ_JWT_SECRET) return res.status(503).json({ error: 'agentq not configured' })
  const { title, prompt, session } = req.body
  if (!title || !prompt) return res.status(400).json({ error: 'title and prompt required' })
  try {
    const token = signAgentqJwt(req.user?.username)
    const r = await agentqFetch(`${AGENTQ_URL}/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, prompt, repo: '/home/kevinprk/homeserver/apps/task', ...(session ? { session } : {}) }),
    })
    const data = await r.json()
    res.status(r.status).json(data)
  } catch {
    res.status(502).json({ error: 'agentq unreachable' })
  }
})

app.get('/api/agentq/tasks', auth, async (req, res) => {
  if (!AGENTQ_JWT_SECRET) return res.status(503).json({ error: 'agentq not configured' })
  try {
    const token = signAgentqJwt(req.user?.username)
    const qs = req.query.status ? `?status=${req.query.status}` : ''
    const r = await agentqFetch(`${AGENTQ_URL}/v1/tasks${qs}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await r.json()
    res.status(r.status).json(data)
  } catch {
    res.status(502).json({ error: 'agentq unreachable' })
  }
})

app.get('/api/agentq/tasks/:id', auth, async (req, res) => {
  if (!AGENTQ_JWT_SECRET) return res.status(503).json({ error: 'agentq not configured' })
  try {
    const token = signAgentqJwt(req.user?.username)
    const r = await agentqFetch(`${AGENTQ_URL}/v1/tasks/${req.params.id}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await r.json()
    res.status(r.status).json(data)
  } catch {
    res.status(502).json({ error: 'agentq unreachable' })
  }
})

// ── Goals ─────────────────────────────────────────────────────────────
app.get('/api/goals', auth, async (_req, res) => {
  const { rows: periods } = await pool.query('SELECT * FROM goal_periods ORDER BY year DESC, half DESC')
  const { rows: categories } = await pool.query('SELECT * FROM goal_categories ORDER BY position ASC, created_at ASC')
  const { rows: items } = await pool.query('SELECT * FROM goal_items ORDER BY position ASC, created_at ASC')
  const itemsByCategory = {}
  for (const item of items) {
    if (!itemsByCategory[item.category_id]) itemsByCategory[item.category_id] = []
    itemsByCategory[item.category_id].push(item)
  }
  const categoriesByPeriod = {}
  for (const cat of categories) {
    if (!categoriesByPeriod[cat.period_id]) categoriesByPeriod[cat.period_id] = []
    categoriesByPeriod[cat.period_id].push({ ...cat, items: itemsByCategory[cat.id] ?? [] })
  }
  res.json(periods.map(p => ({ ...p, categories: categoriesByPeriod[p.id] ?? [] })))
})

app.post('/api/goals/periods', auth, async (req, res) => {
  const { year, half } = req.body ?? {}
  if (!year || ![1, 2].includes(half)) return res.status(400).json({ error: 'year and half (1|2) required' })
  const id = randomUUID()
  const { rows } = await pool.query(
    'INSERT INTO goal_periods (id, year, half) VALUES ($1,$2,$3) ON CONFLICT (year, half) DO UPDATE SET year=$2 RETURNING *',
    [id, year, half]
  )
  res.json({ ...rows[0], categories: [] })
})

app.delete('/api/goals/periods/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM goal_periods WHERE id = $1', [req.params.id])
  res.json({})
})

app.post('/api/goals/categories', auth, async (req, res) => {
  const { period_id, name } = req.body ?? {}
  if (!period_id || !name?.trim()) return res.status(400).json({ error: 'period_id and name required' })
  const { rows: [pos] } = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM goal_categories WHERE period_id=$1', [period_id])
  const id = randomUUID()
  const { rows } = await pool.query(
    'INSERT INTO goal_categories (id, period_id, name, position) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, period_id, name.trim(), pos.p]
  )
  res.json({ ...rows[0], items: [] })
})

app.put('/api/goals/categories/:id', auth, async (req, res) => {
  const { name } = req.body ?? {}
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  const { rows } = await pool.query('UPDATE goal_categories SET name=$1 WHERE id=$2 RETURNING *', [name.trim(), req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

app.delete('/api/goals/categories/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM goal_categories WHERE id = $1', [req.params.id])
  res.json({})
})

app.post('/api/goals/items', auth, async (req, res) => {
  const { category_id, text } = req.body ?? {}
  if (!category_id || !text?.trim()) return res.status(400).json({ error: 'category_id and text required' })
  const { rows: [pos] } = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM goal_items WHERE category_id=$1', [category_id])
  const id = randomUUID()
  const { rows } = await pool.query(
    'INSERT INTO goal_items (id, category_id, text, position) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, category_id, text.trim(), pos.p]
  )
  res.json(rows[0])
})

app.put('/api/goals/items/:id', auth, async (req, res) => {
  const { text, completed, crossed_out, note } = req.body ?? {}
  const sets = []
  const params = []
  if (text !== undefined) { params.push(text.trim()); sets.push(`text = $${params.length}`) }
  if (completed !== undefined) { params.push(completed); sets.push(`completed = $${params.length}`) }
  if (crossed_out !== undefined) { params.push(crossed_out); sets.push(`crossed_out = $${params.length}`) }
  if ('note' in (req.body ?? {})) { params.push(note ?? null); sets.push(`note = $${params.length}`) }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' })
  params.push(req.params.id)
  const { rows } = await pool.query(`UPDATE goal_items SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params)
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

app.delete('/api/goals/items/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM goal_items WHERE id = $1', [req.params.id])
  res.json({})
})

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
    // Use the inline <content> CDATA from the feed — avoids fetching individual pages
    // which are blocked server-side (hada.io returns 403 for server requests)
    const preview = /<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/.exec(b)?.[1]?.trim() ?? null
    if (title && link) items.push({ title, link, published, author, preview })
  }
  return items
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
