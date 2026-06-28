import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const DB_PATH = process.env.DB_PATH || join(__dirname, '../task.db')
const TASK_USERNAME = process.env.TASK_USERNAME || 'kevinprk'
const TASK_PASSWORD = process.env.TASK_PASSWORD || ''

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    slot TEXT NOT NULL,
    text TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_additions (
    id TEXT PRIMARY KEY,
    slot_date TEXT NOT NULL,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
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
  INSERT OR IGNORE INTO settings VALUES ('rotateHour', '6');
  INSERT OR IGNORE INTO settings VALUES ('rotateMinute', '0');
  INSERT OR IGNORE INTO settings VALUES ('keepBonus', 'false');
`)

const app = express()
const distPath = join(__dirname, '../dist')
app.use(express.static(distPath))
app.use(express.json())

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

// Auth
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' })
  if (username !== TASK_USERNAME) return res.status(401).json({ error: 'Invalid credentials' })
  if (!TASK_PASSWORD) return res.status(503).json({ error: 'TASK_PASSWORD not set' })

  const valid = TASK_PASSWORD.startsWith('$2')
    ? await bcrypt.compare(password, TASK_PASSWORD)
    : password === TASK_PASSWORD

  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token })
})

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ username: req.user.username })
})

// Templates
app.get('/api/templates', auth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY slot, position').all()
  const grouped = { mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [] }
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(grouped, row.slot)) grouped[row.slot].push(row)
  }
  res.json(grouped)
})

app.post('/api/templates', auth, (req, res) => {
  const { slot, text } = req.body ?? {}
  const VALID = ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend']
  if (!VALID.includes(slot) || !text?.trim()) return res.status(400).json({ error: 'Invalid slot or text' })
  const { m } = db.prepare('SELECT MAX(position) as m FROM templates WHERE slot = ?').get(slot)
  const position = (m ?? -1) + 1
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO templates VALUES (?, ?, ?, ?, ?)').run(id, slot, text.trim(), position, now)
  res.json({ id, slot, text: text.trim(), position, created_at: now })
})

app.put('/api/templates/reorder', auth, (req, res) => {
  const { slot, ids } = req.body ?? {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be array' })
  const update = db.prepare('UPDATE templates SET position = ? WHERE id = ? AND slot = ?')
  db.transaction(() => { ids.forEach((id, i) => update.run(i, id, slot)) })()
  res.json({ ok: true })
})

app.put('/api/templates/:id', auth, (req, res) => {
  const { text } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
  db.prepare('UPDATE templates SET text = ? WHERE id = ?').run(text.trim(), req.params.id)
  res.json(db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id))
})

app.delete('/api/templates/:id', auth, (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id)
  db.prepare('DELETE FROM template_completions WHERE template_id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Daily
const DAY_TO_SLOT = ['weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'weekend']

app.get('/api/daily/:slotDate', auth, (req, res) => {
  const { slotDate } = req.params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return res.status(400).json({ error: 'Invalid date' })
  const [y, m, d] = slotDate.split('-').map(Number)
  const slot = DAY_TO_SLOT[new Date(y, m - 1, d).getDay()]
  const templates = db.prepare('SELECT * FROM templates WHERE slot = ? ORDER BY position').all(slot)
  const completedIds = new Set(
    db.prepare('SELECT template_id FROM template_completions WHERE slot_date = ?')
      .all(slotDate).map(r => r.template_id)
  )
  const additions = db.prepare(
    'SELECT * FROM daily_additions WHERE slot_date = ? ORDER BY created_at'
  ).all(slotDate).map(r => ({ ...r, completed: r.completed === 1 }))

  res.json({
    slotDate,
    slot,
    templates: templates.map(t => ({ ...t, completed: completedIds.has(t.id) })),
    additions,
  })
})

app.post('/api/daily/additions', auth, (req, res) => {
  const { slotDate, text } = req.body ?? {}
  if (!slotDate || !text?.trim()) return res.status(400).json({ error: 'Missing fields' })
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO daily_additions VALUES (?, ?, ?, 0, ?)').run(id, slotDate, text.trim(), now)
  res.json({ id, slot_date: slotDate, text: text.trim(), completed: false, created_at: now })
})

app.put('/api/daily/additions/:id', auth, (req, res) => {
  const { text } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' })
  db.prepare('UPDATE daily_additions SET text = ? WHERE id = ?').run(text.trim(), req.params.id)
  const row = db.prepare('SELECT * FROM daily_additions WHERE id = ?').get(req.params.id)
  res.json({ ...row, completed: row.completed === 1 })
})

app.delete('/api/daily/additions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM daily_additions WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

app.post('/api/daily/toggle', auth, (req, res) => {
  const { type, id, slotDate, completed } = req.body ?? {}
  if (type === 'template') {
    if (completed) {
      db.prepare('INSERT OR IGNORE INTO template_completions VALUES (?, ?)').run(id, slotDate)
    } else {
      db.prepare('DELETE FROM template_completions WHERE template_id = ? AND slot_date = ?').run(id, slotDate)
    }
  } else {
    db.prepare('UPDATE daily_additions SET completed = ? WHERE id = ?').run(completed ? 1 : 0, id)
  }
  res.json({ ok: true })
})

// Settings
app.get('/api/settings', auth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all()
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]))
  res.json({
    rotateHour: parseInt(s.rotateHour ?? '6'),
    rotateMinute: parseInt(s.rotateMinute ?? '0'),
    keepBonus: s.keepBonus === 'true',
  })
})

app.put('/api/settings', auth, (req, res) => {
  const { rotateHour, rotateMinute, keepBonus } = req.body ?? {}
  const upsert = db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)')
  db.transaction(() => {
    if (rotateHour !== undefined) upsert.run('rotateHour', String(rotateHour))
    if (rotateMinute !== undefined) upsert.run('rotateMinute', String(rotateMinute))
    if (keepBonus !== undefined) upsert.run('keepBonus', String(keepBonus))
  })()
  const rows = db.prepare('SELECT * FROM settings').all()
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]))
  res.json({
    rotateHour: parseInt(s.rotateHour),
    rotateMinute: parseInt(s.rotateMinute),
    keepBonus: s.keepBonus === 'true',
  })
})

// Export / Import
app.get('/api/export', auth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY slot, position').all()
  const grouped = { mon: [], tue: [], wed: [], thu: [], fri: [], weekend: [] }
  for (const t of rows) {
    if (Object.prototype.hasOwnProperty.call(grouped, t.slot)) grouped[t.slot].push(t)
  }
  const sRows = db.prepare('SELECT * FROM settings').all()
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

app.post('/api/import', auth, (req, res) => {
  const { data, mode } = req.body ?? {}
  if (!data?.templates) return res.status(400).json({ error: 'Invalid data' })
  const VALID = ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend']
  const insert = db.prepare('INSERT OR IGNORE INTO templates VALUES (?, ?, ?, ?, ?)')
  db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM templates').run()
      db.prepare('DELETE FROM template_completions').run()
    }
    for (const slot of VALID) {
      const items = data.templates[slot] ?? []
      for (const t of items) {
        if (mode === 'merge') {
          const exists = db.prepare('SELECT id FROM templates WHERE slot = ? AND text = ?').get(slot, t.text)
          if (exists) continue
        }
        insert.run(t.id || randomUUID(), slot, t.text, t.position ?? 0, t.created_at ?? Date.now())
      }
    }
    if (data.settings) {
      const upsert = db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)')
      if (data.settings.rotateHour !== undefined) upsert.run('rotateHour', String(data.settings.rotateHour))
      if (data.settings.rotateMinute !== undefined) upsert.run('rotateMinute', String(data.settings.rotateMinute))
      if (data.settings.keepBonus !== undefined) upsert.run('keepBonus', String(data.settings.keepBonus))
    }
  })()
  res.json({ ok: true })
})

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(distPath, 'index.html'))
})

app.listen(PORT, () => console.log(`task server :${PORT}`))
